import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createVault,
  unlockWithPasscode,
  unlockWithRecoveryKey,
} from '../src/lib/crypto';
import {
  enableProtection,
  initPersistence,
  lockoutRemainingMs,
  saveData,
  unlock,
  unlockWithRecovery,
} from '../src/lib/persistence';
import { createEncryptedBackupText, inspectBackup, openEncryptedBackup } from '../src/lib/backup';
import {
  STORAGE_KEY,
  createEvaluation,
  createStudent,
  type StorageLike,
} from '../src/lib/store';
import type { Store } from '../src/lib/types';

const LONG = 30_000;

function sampleStore(): Store {
  const student = createStudent('Example Student A', '2019-05-04', 'Invented test data only.');
  student.evaluations.push(createEvaluation(student.id));
  return { version: 1, students: [student] };
}

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
  };
}

const emptyLegacy: StorageLike = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('vault cryptography', () => {
  it(
    'encrypts and decrypts a store with the passcode, and a wrong passcode fails',
    async () => {
      const store = sampleStore();
      const plaintext = JSON.stringify(store);
      const { envelope } = await createVault(plaintext, 'correct horse battery');

      const unlocked = await unlockWithPasscode(envelope, 'correct horse battery');
      expect(unlocked.plaintext).toBe(plaintext);

      await expect(unlockWithPasscode(envelope, 'wrong passcode here')).rejects.toThrow();
    },
    LONG,
  );

  it(
    'unlocks with the recovery key returned at setup',
    async () => {
      const store = sampleStore();
      const plaintext = JSON.stringify(store);
      const { envelope, recoveryKey } = await createVault(plaintext, 'correct horse battery');

      const unlocked = await unlockWithRecoveryKey(envelope, recoveryKey);
      expect(unlocked.plaintext).toBe(plaintext);

      await expect(unlockWithRecoveryKey(envelope, 'AAAA-AAAA-AAAA')).rejects.toThrow();
    },
    LONG,
  );
});

describe('recovery flow through persistence', () => {
  it(
    'recovery key unlocks, resets the passcode, and the old passcode stops working',
    async () => {
      const store = sampleStore();
      const { recoveryKey } = await enableProtection(store, 'first passcode value');

      const recovered = await unlockWithRecovery(recoveryKey, 'second passcode value');
      expect(recovered.ok).toBe(true);
      if (recovered.ok) {
        expect(recovered.store.students[0].name).toBe('Example Student A');
      }

      const withNew = await unlock('second passcode value');
      expect(withNew.ok).toBe(true);

      const withOld = await unlock('first passcode value');
      expect(withOld.ok).toBe(false);
    },
    LONG,
  );
});

describe('local storage to IndexedDB migration', () => {
  it('migrates a seeded legacy store intact and removes the legacy key only after success', async () => {
    const legacy = memoryStorage();
    const store = sampleStore();
    legacy.setItem(STORAGE_KEY, JSON.stringify(store));

    const init = await initPersistence(legacy);
    expect(init.status).toBe('ready');
    if (init.status === 'ready') {
      expect(init.migrated).toBe(true);
      expect(init.store.students).toHaveLength(1);
      expect(init.store.students[0].name).toBe('Example Student A');
      expect(init.store.students[0].evaluations).toHaveLength(1);
    }
    expect(legacy.getItem(STORAGE_KEY)).toBeNull();

    const again = await initPersistence(legacy);
    expect(again.status).toBe('ready');
    if (again.status === 'ready') {
      expect(again.migrated).toBe(false);
      expect(again.store.students).toHaveLength(1);
    }
  });

  it('reports a fresh install when no data exists anywhere', async () => {
    const init = await initPersistence(emptyLegacy);
    expect(init.status).toBe('fresh');
  });
});

describe('unlock lockout', () => {
  it(
    'counts failures across calls, locks at the threshold, and the lockout persists',
    async () => {
      await enableProtection(sampleStore(), 'the right passcode');

      for (let i = 0; i < 4; i += 1) {
        const attempt = await unlock('a wrong passcode');
        expect(attempt.ok).toBe(false);
        if (!attempt.ok) expect(attempt.lockoutRemainingMs).toBe(0);
      }

      const fifth = await unlock('a wrong passcode');
      expect(fifth.ok).toBe(false);
      if (!fifth.ok) {
        expect(fifth.lockoutRemainingMs).toBeGreaterThan(0);
        expect(fifth.lockoutRemainingMs).toBeLessThanOrEqual(30_000);
      }

      expect(await lockoutRemainingMs()).toBeGreaterThan(0);

      const duringLockout = await unlock('the right passcode');
      expect(duringLockout.ok).toBe(false);
    },
    LONG,
  );
});

describe('encrypted saves', () => {
  it(
    'saves while unlocked and reads back after a simulated reload',
    async () => {
      const store = sampleStore();
      const { session } = await enableProtection(store, 'save test passcode');

      const bigger: Store = {
        version: 1,
        students: [...store.students, createStudent('Example Student B', '', 'Invented.')],
      };
      const saved = await saveData(bigger, session);
      expect(saved.result.ok).toBe(true);

      const init = await initPersistence(emptyLegacy);
      expect(init.status).toBe('locked');

      const reopened = await unlock('save test passcode');
      expect(reopened.ok).toBe(true);
      if (reopened.ok) {
        expect(reopened.store.students).toHaveLength(2);
        expect(reopened.store.students[1].name).toBe('Example Student B');
      }
    },
    LONG,
  );
});

describe('encrypted backups', () => {
  it(
    'round trips through export and import, and a wrong password changes nothing',
    async () => {
      const store = sampleStore();
      const text = await createEncryptedBackupText(store, 'backup password 1');

      const inspection = inspectBackup(text);
      expect(inspection.kind).toBe('encrypted');

      const wrong = await openEncryptedBackup(text, 'backup password 2');
      expect(wrong.ok).toBe(false);
      if (!wrong.ok) expect(wrong.error).toContain('did not open this backup');

      const right = await openEncryptedBackup(text, 'backup password 1');
      expect(right.ok).toBe(true);
      if (right.ok) {
        expect(right.store.students).toHaveLength(1);
        expect(right.store.students[0].name).toBe('Example Student A');
      }

      const plainInspection = inspectBackup(JSON.stringify(store));
      expect(plainInspection.kind).toBe('plain');
    },
    LONG,
  );
});
