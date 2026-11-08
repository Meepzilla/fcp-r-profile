// Local store: students and their evaluations, persisted as one JSON
// document in localStorage under a versioned key.
// Data never leaves this device. There is no server and no account.
//
// Save rule, carried over from the AscendEd DataTool work: a save is only
// reported as successful after the write completes and reads back. Write
// failures are returned to the caller and shown in the UI, never hidden.

import type { AnswerMap, Evaluation, Store, Student } from './types';

export const STORAGE_KEY = 'fcpr-store-v1';
export const SIZE_WARNING_BYTES = 4 * 1024 * 1024;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function defaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    return null;
  }
  return null;
}

export function emptyStore(): Store {
  return { version: 1, students: [] };
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createStudent(name: string, birthdate: string, notes: string): Student {
  const now = nowIso();
  return {
    id: uid(),
    name: name.trim(),
    birthdate,
    notes,
    createdAt: now,
    updatedAt: now,
    evaluations: [],
  };
}

export function createEvaluation(studentId: string, answers: AnswerMap = {}): Evaluation {
  const now = nowIso();
  return {
    id: uid(),
    studentId,
    status: 'in-progress',
    createdAt: now,
    updatedAt: now,
    answers,
  };
}

export interface SaveResult {
  ok: boolean;
  error?: string;
  sizeBytes: number;
  overSizeWarning: boolean;
}

export function saveStore(store: Store, storage: StorageLike | null = defaultStorage()): SaveResult {
  const serialized = JSON.stringify(store);
  const sizeBytes = new Blob([serialized]).size;
  const overSizeWarning = sizeBytes > SIZE_WARNING_BYTES;
  if (!storage) {
    return { ok: false, error: 'Storage is not available in this browser.', sizeBytes, overSizeWarning };
  }
  try {
    storage.setItem(STORAGE_KEY, serialized);
  } catch (err) {
    return {
      ok: false,
      error: `Save failed: ${err instanceof Error ? err.message : 'storage write was refused.'}`,
      sizeBytes,
      overSizeWarning,
    };
  }
  // Read back before reporting success.
  try {
    const readBack = storage.getItem(STORAGE_KEY);
    if (readBack !== serialized) {
      return { ok: false, error: 'Save could not be verified after writing.', sizeBytes, overSizeWarning };
    }
  } catch {
    return { ok: false, error: 'Save could not be verified after writing.', sizeBytes, overSizeWarning };
  }
  return { ok: true, sizeBytes, overSizeWarning };
}

export function loadStore(storage: StorageLike | null = defaultStorage()): { store: Store; error?: string } {
  if (!storage) return { store: emptyStore(), error: 'Storage is not available in this browser.' };
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { store: emptyStore(), error: 'Saved data could not be read.' };
  }
  if (!raw) return { store: emptyStore() };
  try {
    const parsed = JSON.parse(raw);
    const result = validateStore(parsed);
    if (!result.ok) return { store: emptyStore(), error: result.error };
    return { store: result.store };
  } catch {
    return { store: emptyStore(), error: 'Saved data is damaged and could not be opened.' };
  }
}

export type ValidationResult = { ok: true; store: Store } | { ok: false; error: string };

export function validateStore(value: unknown): ValidationResult {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, error: 'The file is not a valid FCP-R backup.' };
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !Array.isArray(candidate.students)) {
    return { ok: false, error: 'The file is not a valid FCP-R backup.' };
  }
  for (const rawStudent of candidate.students) {
    if (typeof rawStudent !== 'object' || rawStudent === null) {
      return { ok: false, error: 'The backup contains a student record with the wrong shape.' };
    }
    const s = rawStudent as Record<string, unknown>;
    if (typeof s.id !== 'string' || typeof s.name !== 'string' || !Array.isArray(s.evaluations)) {
      return { ok: false, error: 'The backup contains a student record with the wrong shape.' };
    }
    for (const rawEval of s.evaluations as unknown[]) {
      if (typeof rawEval !== 'object' || rawEval === null) {
        return { ok: false, error: 'The backup contains an evaluation with the wrong shape.' };
      }
      const e = rawEval as Record<string, unknown>;
      if (
        typeof e.id !== 'string' ||
        typeof e.answers !== 'object' ||
        e.answers === null ||
        Array.isArray(e.answers)
      ) {
        return { ok: false, error: 'The backup contains an evaluation with the wrong shape.' };
      }
    }
  }
  return { ok: true, store: value as Store };
}

export function parseBackup(text: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  return validateStore(parsed);
}

export function touchStudent(store: Store, studentId: string): Store {
  return {
    ...store,
    students: store.students.map((s) =>
      s.id === studentId ? { ...s, updatedAt: nowIso() } : s,
    ),
  };
}
