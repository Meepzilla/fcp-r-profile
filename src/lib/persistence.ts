// Persistence on IndexedDB, with optional passcode protection.
//
// Layout in IndexedDB:
// - one data record: either the plain store JSON, or a vault envelope
//   (see crypto.ts) when passcode protection is on
// - one security meta record: protection mode plus unlock lockout state,
//   kept outside the encrypted payload so a reload cannot reset a lockout
//
// Migration: the v0.1.x store lived in localStorage under fcpr-store-v1.
// On first run here, that data is written to IndexedDB, read back and
// verified, and only then is the localStorage copy removed. A failed
// migration keeps the localStorage copy and surfaces an error.
//
// Save rule: a save is reported successful only after the IndexedDB write
// completes and the value reads back identical. Failures are returned to
// the caller and shown in the UI.

import {
  createVault,
  isVaultEnvelope,
  rewrapPasscode,
  sealStore,
  unlockWithPasscode,
  unlockWithRecoveryKey,
  type VaultEnvelope,
} from './crypto';
import { DATA_KEY, META_KEY, idbGet, idbSet } from './idb';
import {
  STORAGE_KEY,
  SIZE_WARNING_BYTES,
  defaultStorage,
  emptyStore,
  validateStore,
  type SaveResult,
  type StorageLike,
} from './store';
import type { Store } from './types';

export type ProtectionMode = 'plain' | 'encrypted';

export interface SecurityMeta {
  mode: ProtectionMode;
  failedAttempts: number;
  lockoutLevel: number;
  lockedUntil: number;
}

interface DataRecord {
  mode: ProtectionMode;
  plain?: string;
  envelope?: VaultEnvelope;
}

export type Session =
  | { mode: 'plain' }
  | { mode: 'encrypted'; dataKey: Uint8Array; envelope: VaultEnvelope };

export const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_BASE_MS = 30_000;
const LOCKOUT_MAX_MS = 15 * 60_000;

function defaultMeta(mode: ProtectionMode): SecurityMeta {
  return { mode, failedAttempts: 0, lockoutLevel: 0, lockedUntil: 0 };
}

export function lockoutDelayMs(level: number): number {
  return Math.min(LOCKOUT_BASE_MS * 2 ** level, LOCKOUT_MAX_MS);
}

async function readMeta(): Promise<SecurityMeta | null> {
  const raw = await idbGet(META_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SecurityMeta;
    if (parsed.mode !== 'plain' && parsed.mode !== 'encrypted') return null;
    return {
      mode: parsed.mode,
      failedAttempts: parsed.failedAttempts ?? 0,
      lockoutLevel: parsed.lockoutLevel ?? 0,
      lockedUntil: parsed.lockedUntil ?? 0,
    };
  } catch {
    return null;
  }
}

async function writeMeta(meta: SecurityMeta): Promise<void> {
  await idbSet(META_KEY, JSON.stringify(meta));
}

async function readRecord(): Promise<DataRecord | null> {
  const raw = await idbGet(DATA_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DataRecord;
    if (parsed.mode === 'plain' && typeof parsed.plain === 'string') return parsed;
    if (parsed.mode === 'encrypted' && isVaultEnvelope(parsed.envelope)) return parsed;
    return null;
  } catch {
    return null;
  }
}

async function writeRecord(record: DataRecord): Promise<void> {
  const serialized = JSON.stringify(record);
  await idbSet(DATA_KEY, serialized);
  const readBack = await idbGet(DATA_KEY);
  if (readBack !== serialized) throw new Error('Save could not be verified after writing.');
}

function parsePlainStore(serialized: string): Store {
  const result = validateStore(JSON.parse(serialized));
  if (!result.ok) throw new Error(result.error);
  return result.store;
}

export type InitResult =
  | { status: 'fresh' }
  | { status: 'ready'; store: Store; session: Session; migrated: boolean }
  | { status: 'locked'; lockoutRemainingMs: number }
  | { status: 'error'; error: string };

export async function lockoutRemainingMs(): Promise<number> {
  const meta = await readMeta();
  if (!meta) return 0;
  return Math.max(0, meta.lockedUntil - Date.now());
}

export async function initPersistence(
  legacyStorage: StorageLike | null = defaultStorage(),
): Promise<InitResult> {
  let record: DataRecord | null;
  try {
    record = await readRecord();
  } catch {
    return { status: 'error', error: 'Saved data could not be read from this browser database.' };
  }

  if (record) {
    if (record.mode === 'encrypted') {
      return { status: 'locked', lockoutRemainingMs: await lockoutRemainingMs() };
    }
    try {
      return {
        status: 'ready',
        store: parsePlainStore(record.plain as string),
        session: { mode: 'plain' },
        migrated: false,
      };
    } catch {
      return { status: 'error', error: 'Saved data is damaged and could not be opened.' };
    }
  }

  // No IndexedDB record yet. Migrate the v0.1.x localStorage store if one
  // exists. The localStorage copy is removed only after the IndexedDB copy
  // is written and verified.
  let legacyRaw: string | null = null;
  try {
    legacyRaw = legacyStorage ? legacyStorage.getItem(STORAGE_KEY) : null;
  } catch {
    return { status: 'error', error: 'Existing saved data could not be read. Nothing was changed.' };
  }
  if (legacyRaw) {
    let store: Store;
    try {
      store = parsePlainStore(legacyRaw);
    } catch {
      return {
        status: 'error',
        error: 'Existing saved data is damaged and was left untouched in its old location.',
      };
    }
    try {
      await writeRecord({ mode: 'plain', plain: legacyRaw });
      await writeMeta(defaultMeta('plain'));
      const check = await readRecord();
      if (!check || check.mode !== 'plain' || parsePlainStore(check.plain as string).students.length !== store.students.length) {
        throw new Error('Migration verification failed.');
      }
    } catch {
      return {
        status: 'error',
        error: 'Moving saved data to the new storage failed. Your existing data was kept in its old location.',
      };
    }
    try {
      legacyStorage?.removeItem(STORAGE_KEY);
    } catch {
      // The IndexedDB copy is verified and authoritative now. A leftover
      // legacy copy is ignored on later runs because the record exists.
    }
    return { status: 'ready', store, session: { mode: 'plain' }, migrated: true };
  }

  return { status: 'fresh' };
}

export interface SaveOutcome {
  result: SaveResult;
  session: Session;
}

export async function saveData(store: Store, session: Session): Promise<SaveOutcome> {
  const serialized = JSON.stringify(store);
  const sizeBytes = new Blob([serialized]).size;
  const overSizeWarning = sizeBytes > SIZE_WARNING_BYTES;
  try {
    if (session.mode === 'plain') {
      await writeRecord({ mode: 'plain', plain: serialized });
      return { result: { ok: true, sizeBytes, overSizeWarning }, session };
    }
    const envelope = await sealStore(session.envelope, session.dataKey, serialized);
    await writeRecord({ mode: 'encrypted', envelope });
    return {
      result: { ok: true, sizeBytes, overSizeWarning },
      session: { mode: 'encrypted', dataKey: session.dataKey, envelope },
    };
  } catch (err) {
    return {
      result: {
        ok: false,
        error: `Save failed: ${err instanceof Error ? err.message : 'storage write was refused.'}`,
        sizeBytes,
        overSizeWarning,
      },
      session,
    };
  }
}

async function writePlainStore(store: Store): Promise<Session> {
  await writeRecord({ mode: 'plain', plain: JSON.stringify(store) });
  await writeMeta(defaultMeta('plain'));
  return { mode: 'plain' };
}

// Used both for a fresh install that opts out and for removing a passcode.
export async function savePlainAndSetMode(store: Store): Promise<Session> {
  return writePlainStore(store);
}

export async function enableProtection(
  store: Store,
  passcode: string,
): Promise<{ recoveryKey: string; session: Session }> {
  const created = await createVault(JSON.stringify(store), passcode);
  await writeRecord({ mode: 'encrypted', envelope: created.envelope });
  await writeMeta(defaultMeta('encrypted'));
  return {
    recoveryKey: created.recoveryKey,
    session: { mode: 'encrypted', dataKey: created.dataKey, envelope: created.envelope },
  };
}

async function recordFailedAttempt(meta: SecurityMeta): Promise<SecurityMeta> {
  const next: SecurityMeta = { ...meta, failedAttempts: meta.failedAttempts + 1 };
  if (next.failedAttempts >= LOCKOUT_THRESHOLD) {
    next.lockedUntil = Date.now() + lockoutDelayMs(next.lockoutLevel);
    next.lockoutLevel += 1;
    next.failedAttempts = 0;
  }
  await writeMeta(next);
  return next;
}

export type UnlockOutcome =
  | { ok: true; store: Store; session: Session }
  | { ok: false; error: string; lockoutRemainingMs: number };

async function tryUnlock(
  secret: string,
  useRecovery: boolean,
  newPasscode?: string,
): Promise<UnlockOutcome> {
  const meta = (await readMeta()) ?? defaultMeta('encrypted');
  const remaining = Math.max(0, meta.lockedUntil - Date.now());
  if (remaining > 0) {
    return {
      ok: false,
      error: `Too many failed attempts. Try again in ${Math.ceil(remaining / 1000)} seconds.`,
      lockoutRemainingMs: remaining,
    };
  }
  const record = await readRecord();
  if (!record || record.mode !== 'encrypted' || !record.envelope) {
    return { ok: false, error: 'This store is not passcode protected.', lockoutRemainingMs: 0 };
  }
  try {
    const unlocked = useRecovery
      ? await unlockWithRecoveryKey(record.envelope, secret)
      : await unlockWithPasscode(record.envelope, secret);
    const store = parsePlainStore(unlocked.plaintext);
    let envelope = record.envelope;
    if (useRecovery && newPasscode) {
      envelope = await rewrapPasscode(envelope, unlocked.dataKey, newPasscode);
      await writeRecord({ mode: 'encrypted', envelope });
    }
    await writeMeta(defaultMeta('encrypted'));
    return {
      ok: true,
      store,
      session: { mode: 'encrypted', dataKey: unlocked.dataKey, envelope },
    };
  } catch (err) {
    const updated = await recordFailedAttempt(meta);
    const lockRemaining = Math.max(0, updated.lockedUntil - Date.now());
    return {
      ok: false,
      error:
        lockRemaining > 0
          ? `Too many failed attempts. Try again in ${Math.ceil(lockRemaining / 1000)} seconds.`
          : err instanceof Error
            ? err.message
            : 'Unlock failed.',
      lockoutRemainingMs: lockRemaining,
    };
  }
}

export async function unlock(passcode: string): Promise<UnlockOutcome> {
  return tryUnlock(passcode, false);
}

export async function unlockWithRecovery(
  recoveryKey: string,
  newPasscode: string,
): Promise<UnlockOutcome> {
  return tryUnlock(recoveryKey, true, newPasscode);
}

export async function changePasscode(session: Session, newPasscode: string): Promise<Session> {
  if (session.mode !== 'encrypted') throw new Error('Passcode protection is not on.');
  const envelope = await rewrapPasscode(session.envelope, session.dataKey, newPasscode);
  await writeRecord({ mode: 'encrypted', envelope });
  return { mode: 'encrypted', dataKey: session.dataKey, envelope };
}

export async function disableProtection(store: Store): Promise<Session> {
  return writePlainStore(store);
}

export async function getProtectionMode(): Promise<ProtectionMode | null> {
  const meta = await readMeta();
  return meta ? meta.mode : null;
}

export { emptyStore };
