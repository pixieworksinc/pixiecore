/**
 * Provides reusable distribution signature primitives for PixieCore.
 */

import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonicalJson } from '../json-artifact/index.js';

export { canonicalJson } from '../json-artifact/index.js';

/**
 * Describes the distribution signature contract.
 */
export interface DistributionSignature { readonly algorithm: 'Ed25519'; readonly keyId: string; readonly value: string }
/**
 * Defines the supported distribution signature status values.
 */
export type DistributionSignatureStatus = 'absent' | 'verified' | 'present-unverified';

/**
 * Signs distribution value for the owning PixieCore boundary.
 */
export async function signDistributionValue(value: unknown, privateKeyPath: string, label: string): Promise<DistributionSignature> {
  const privateKey = createPrivateKey(await readFile(privateKeyPath));
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new TypeError(`${label} signatures require an Ed25519 private key`);
  const publicKey = createPublicKey(privateKey);
  return Object.freeze({ algorithm: 'Ed25519', keyId: keyId(publicKey.export({ type: 'spki', format: 'der' })), value: sign(null, Buffer.from(canonicalJson(value)), privateKey).toString('base64') });
}

/**
 * Validates distribution value and rejects unsupported input.
 */
export async function verifyDistributionValue(value: unknown, signature: DistributionSignature | undefined, options: { readonly publicKeyPath?: string; readonly requireSignature?: boolean; readonly label: string }): Promise<DistributionSignatureStatus> {
  if (!signature) { if (options.requireSignature) throw new TypeError(`A verified ${options.label} signature is required`); return 'absent'; }
  if (!options.publicKeyPath) { if (options.requireSignature) throw new TypeError(`A verified ${options.label} signature is required`); return 'present-unverified'; }
  const publicKey = createPublicKey(await readFile(options.publicKeyPath));
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new TypeError(`${options.label} signatures require an Ed25519 public key`);
  if (keyId(publicKey.export({ type: 'spki', format: 'der' })) !== signature.keyId) throw new TypeError(`${options.label} signature key ID does not match the supplied public key`);
  if (!verify(null, Buffer.from(canonicalJson(value)), publicKey, Buffer.from(signature.value, 'base64'))) throw new TypeError(`${options.label} signature is invalid`);
  return 'verified';
}

function keyId(value: ArrayBuffer | Uint8Array): string { return createHash('sha256').update(value instanceof ArrayBuffer ? new Uint8Array(value) : value).digest('hex'); }
