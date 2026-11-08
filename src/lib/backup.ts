// Backup file handling: plain JSON and password-protected backups.
//
// The import flow inspects a file before anything changes. A plain file
// is validated as a store. An encrypted file is reported as encrypted so
// the UI can ask for its password; the password attempt decrypts and
// validates, and a wrong password changes nothing.

import { decryptBackup, encryptBackup, isEncryptedBackup } from './crypto';
import { parseBackup, type ValidationResult } from './store';
import type { Store } from './types';

export type BackupInspection =
  | { kind: 'plain'; result: ValidationResult }
  | { kind: 'encrypted' }
  | { kind: 'error'; error: string };

export function inspectBackup(text: string): BackupInspection {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'error', error: 'That file is not valid JSON.' };
  }
  if (isEncryptedBackup(parsed)) return { kind: 'encrypted' };
  return { kind: 'plain', result: parseBackup(text) };
}

export async function createEncryptedBackupText(store: Store, password: string): Promise<string> {
  const encrypted = await encryptBackup(JSON.stringify(store), password);
  return JSON.stringify(encrypted, null, 2);
}

export async function openEncryptedBackup(text: string, password: string): Promise<ValidationResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  if (!isEncryptedBackup(parsed)) {
    return { ok: false, error: 'That file is not an encrypted FCP-R backup.' };
  }
  try {
    const plaintext = await decryptBackup(parsed, password);
    return parseBackup(plaintext);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'That password did not open this backup.',
    };
  }
}
