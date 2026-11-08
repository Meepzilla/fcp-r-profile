// Passcode and backup cryptography, Web Crypto only.
//
// Model, matched to the AscendEd DataTool security work:
// - AES-256-GCM encrypts the data under a random data key.
// - The data key is wrapped (encrypted) under a key derived from the
//   passcode with PBKDF2-SHA-256 at 600,000 iterations and a random salt.
// - A one-time recovery key, shown once at setup, wraps a second copy of
//   the data key under its own salt. It can unlock the store and reset
//   the passcode.
// - Password-protected backups use the same AES-256-GCM and PBKDF2
//   machinery with a password set at export time.
//
// The data key lives in memory only while the store is unlocked. Nothing
// here makes a network call, and no key material is ever persisted other
// than the wrapped copies inside the vault envelope.

export const PBKDF2_ITERATIONS = 600_000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveKeyBytes(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey('raw', textEncoder.encode(secret), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    baseKey,
    256,
  );
  return new Uint8Array(bits);
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

interface SealedBox {
  iv: string;
  data: string;
}

async function seal(keyRaw: Uint8Array, plaintext: Uint8Array): Promise<SealedBox> {
  const key = await importAesKey(keyRaw);
  const iv = randomBytes(12);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext as BufferSource);
  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(cipher)) };
}

async function openSealed(keyRaw: Uint8Array, box: SealedBox): Promise<Uint8Array> {
  const key = await importAesKey(keyRaw);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(box.iv) as BufferSource },
      key,
      base64ToBytes(box.data) as BufferSource,
    );
    return new Uint8Array(plain);
  } catch {
    throw new Error('Decryption failed.');
  }
}

// Recovery keys

const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

export function generateRecoveryKey(): string {
  const bytes = randomBytes(20); // 160 bits, 32 base32 characters
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += RECOVERY_ALPHABET[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) out += RECOVERY_ALPHABET[(buffer << (5 - bits)) & 31];
  return out.replace(/(.{4})/g, '$1-').replace(/-$/, '');
}

export function normalizeRecoveryKey(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
}

// Vault envelope: the encrypted store as persisted in IndexedDB.

export interface VaultEnvelope {
  kind: 'fcpr-vault';
  version: 1;
  kdf: {
    iterations: number;
    saltPasscode: string;
    saltRecovery: string;
  };
  wrappedByPasscode: SealedBox;
  wrappedByRecovery: SealedBox;
  payload: SealedBox;
}

export function isVaultEnvelope(value: unknown): value is VaultEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.kind === 'fcpr-vault' && v.version === 1;
}

export interface CreatedVault {
  envelope: VaultEnvelope;
  recoveryKey: string;
  dataKey: Uint8Array;
}

export async function createVault(plaintext: string, passcode: string): Promise<CreatedVault> {
  const dataKey = randomBytes(32);
  const saltPasscode = randomBytes(16);
  const saltRecovery = randomBytes(16);
  const recoveryKey = generateRecoveryKey();

  const payload = await seal(dataKey, textEncoder.encode(plaintext));
  const passKek = await deriveKeyBytes(passcode, saltPasscode, PBKDF2_ITERATIONS);
  const wrappedByPasscode = await seal(passKek, dataKey);
  const recoveryKek = await deriveKeyBytes(normalizeRecoveryKey(recoveryKey), saltRecovery, PBKDF2_ITERATIONS);
  const wrappedByRecovery = await seal(recoveryKek, dataKey);

  return {
    envelope: {
      kind: 'fcpr-vault',
      version: 1,
      kdf: {
        iterations: PBKDF2_ITERATIONS,
        saltPasscode: bytesToBase64(saltPasscode),
        saltRecovery: bytesToBase64(saltRecovery),
      },
      wrappedByPasscode,
      wrappedByRecovery,
      payload,
    },
    recoveryKey,
    dataKey,
  };
}

export interface UnlockedVault {
  plaintext: string;
  dataKey: Uint8Array;
}

async function openWithDataKey(envelope: VaultEnvelope, dataKey: Uint8Array): Promise<UnlockedVault> {
  const plainBytes = await openSealed(dataKey, envelope.payload).catch(() => {
    throw new Error('Saved data could not be decrypted. The vault may be damaged.');
  });
  return { plaintext: textDecoder.decode(plainBytes), dataKey };
}

export async function unlockWithPasscode(
  envelope: VaultEnvelope,
  passcode: string,
): Promise<UnlockedVault> {
  const kek = await deriveKeyBytes(
    passcode,
    base64ToBytes(envelope.kdf.saltPasscode),
    envelope.kdf.iterations,
  );
  let dataKey: Uint8Array;
  try {
    dataKey = await openSealed(kek, envelope.wrappedByPasscode);
  } catch {
    throw new Error('That passcode did not unlock this store.');
  }
  return openWithDataKey(envelope, dataKey);
}

export async function unlockWithRecoveryKey(
  envelope: VaultEnvelope,
  recoveryKey: string,
): Promise<UnlockedVault> {
  const kek = await deriveKeyBytes(
    normalizeRecoveryKey(recoveryKey),
    base64ToBytes(envelope.kdf.saltRecovery),
    envelope.kdf.iterations,
  );
  let dataKey: Uint8Array;
  try {
    dataKey = await openSealed(kek, envelope.wrappedByRecovery);
  } catch {
    throw new Error('That recovery key did not unlock this store.');
  }
  return openWithDataKey(envelope, dataKey);
}

// Re-encrypt the store under the same data key, for saves while unlocked.
export async function sealStore(envelope: VaultEnvelope, dataKey: Uint8Array, plaintext: string): Promise<VaultEnvelope> {
  const payload = await seal(dataKey, textEncoder.encode(plaintext));
  return { ...envelope, payload };
}

// Rewrap the data key under a new passcode. The payload and the recovery
// wrap are untouched, so the recovery key keeps working after a change.
export async function rewrapPasscode(
  envelope: VaultEnvelope,
  dataKey: Uint8Array,
  newPasscode: string,
): Promise<VaultEnvelope> {
  const saltPasscode = randomBytes(16);
  const kek = await deriveKeyBytes(newPasscode, saltPasscode, envelope.kdf.iterations);
  const wrappedByPasscode = await seal(kek, dataKey);
  return {
    ...envelope,
    kdf: { ...envelope.kdf, saltPasscode: bytesToBase64(saltPasscode) },
    wrappedByPasscode,
  };
}

// Password-protected backup files.

export interface EncryptedBackup {
  kind: 'fcpr-encrypted-backup';
  version: 1;
  kdf: { iterations: number; salt: string };
  payload: SealedBox;
}

export function isEncryptedBackup(value: unknown): value is EncryptedBackup {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.kind === 'fcpr-encrypted-backup' && v.version === 1;
}

export async function encryptBackup(plaintext: string, password: string): Promise<EncryptedBackup> {
  const salt = randomBytes(16);
  const key = await deriveKeyBytes(password, salt, PBKDF2_ITERATIONS);
  const payload = await seal(key, textEncoder.encode(plaintext));
  return {
    kind: 'fcpr-encrypted-backup',
    version: 1,
    kdf: { iterations: PBKDF2_ITERATIONS, salt: bytesToBase64(salt) },
    payload,
  };
}

export async function decryptBackup(backup: EncryptedBackup, password: string): Promise<string> {
  const key = await deriveKeyBytes(password, base64ToBytes(backup.kdf.salt), backup.kdf.iterations);
  try {
    const plainBytes = await openSealed(key, backup.payload);
    return textDecoder.decode(plainBytes);
  } catch {
    throw new Error('That password did not open this backup. Nothing was changed.');
  }
}
