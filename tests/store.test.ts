import { describe, expect, it } from 'vitest';
import {
  STORAGE_KEY,
  createEvaluation,
  createStudent,
  emptyStore,
  loadStore,
  parseBackup,
  saveStore,
  validateStore,
  type StorageLike,
} from '../src/lib/store';

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

describe('store persistence', () => {
  it('saves and loads back a store with an invented student', () => {
    const storage = memoryStorage();
    const student = createStudent('Example Student A', '2019-05-04', 'Invented test data only.');
    student.evaluations.push(createEvaluation(student.id));
    const store = { version: 1 as const, students: [student] };

    const result = saveStore(store, storage);
    expect(result.ok).toBe(true);
    expect(storage.data.has(STORAGE_KEY)).toBe(true);

    const loaded = loadStore(storage);
    expect(loaded.error).toBeUndefined();
    expect(loaded.store.students).toHaveLength(1);
    expect(loaded.store.students[0].name).toBe('Example Student A');
    expect(loaded.store.students[0].evaluations).toHaveLength(1);
  });

  it('reports failure when the storage write throws', () => {
    const failing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => undefined,
    };
    const result = saveStore(emptyStore(), failing);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('quota exceeded');
  });

  it('validates backup shape and refuses malformed input', () => {
    expect(parseBackup('not json').ok).toBe(false);
    expect(parseBackup('{"version":2,"students":[]}').ok).toBe(false);
    expect(parseBackup('{"version":1,"students":[{"id":1}]}').ok).toBe(false);
    const good = parseBackup(JSON.stringify(emptyStore()));
    expect(good.ok).toBe(true);
    expect(validateStore(null).ok).toBe(false);
  });
});
