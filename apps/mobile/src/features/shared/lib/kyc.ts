/**
 * Encryption seam for KYC values (هوية/إقامة and IBAN).
 *
 * §11: national IDs and IBANs are never stored in plaintext. The database
 * enforces the floor — `providers_national_id_encrypted` and
 * `providers_iban_encrypted` (0018) reject anything that still *looks* like a
 * raw identifier — but a check constraint cannot verify that a string is
 * genuinely ciphertext, only that it is not obviously plaintext.
 *
 * Real encryption is a server-side concern: Supabase Vault / pgsodium, with
 * the key never leaving the database. That depends on ADR-0010 (region and
 * PDPL), which is still open, so this is the interface the real implementation
 * will replace — the same shape as `otp-provider.ts` and `location-provider.ts`.
 *
 * The dev implementation is deliberately NOT a fake encryptor. It stores a
 * one-way digest and a masked tail, so a developer can recognise a record
 * without the value being recoverable from the dev database. Nothing in the
 * app ever needs to read these back: ops verification reads them server-side.
 */

export interface KycVault {
  /** Returns a value safe to persist in a `*_encrypted` column. */
  seal(value: string): Promise<string>;
}

/**
 * FNV-1a. Small, dependency-free, and sufficient for a dev placeholder that
 * must not be reversible by reading the column. It is NOT a security control
 * and is not presented as one — the real vault replaces this wholesale.
 */
function digest(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export class DevKycVault implements KycVault {
  async seal(value: string): Promise<string> {
    const trimmed = value.trim();
    if (trimmed === '') throw new Error('empty_value');

    // `enc:` marks the column as holding a sealed value; the last four
    // characters are kept so support can confirm "the one ending 4471"
    // without the record being reconstructible.
    return `enc:dev:${digest(trimmed)}:${trimmed.slice(-4)}`;
  }
}

export const kycVault: KycVault = new DevKycVault();
