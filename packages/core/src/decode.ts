/**
 * Runtime decode helpers shared between hand-written call sites (scalar
 * return values, e.g. a `u64` job ID) and the generated struct decoders in
 * `./generated/contract-types.ts`. Hand-written, not generated — this is the
 * one place a `scValToNative` shape mismatch turns into a
 * {@link StellarAgentError} with a useful message instead of a `TypeError`
 * three frames later.
 */
import { StellarAgentError } from './errors.js';

export function expectRecord(value: unknown, context: string): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value instanceof Map) return Object.fromEntries(value);
    return value as Record<string, unknown>;
  }
  throw new StellarAgentError('CONTRACT_ERROR', `Contract returned a malformed ${context}`);
}

export function expectBigInt(value: unknown, context: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (value && typeof value === 'object' && 'value' in value) {
    return expectBigInt((value as { value: unknown }).value, context);
  }
  throw new StellarAgentError(
    'CONTRACT_ERROR',
    `Contract returned a malformed ${context} (expected an integer)`,
  );
}

export function expectU32(value: unknown, context: string): number {
  const number = typeof value === 'bigint' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number)) {
    throw new StellarAgentError(
      'CONTRACT_ERROR',
      `Contract returned a malformed ${context} (expected a u32)`,
    );
  }
  return number;
}

export function expectBool(value: unknown, context: string): boolean {
  if (typeof value === 'boolean') return value;
  throw new StellarAgentError(
    'CONTRACT_ERROR',
    `Contract returned a malformed ${context} (expected a bool)`,
  );
}

/** Covers both `address` and `string`/`symbol` spec types — `scValToNative` returns a plain string for all three. */
export function expectString(value: unknown, context: string): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toString' in value) return String(value);
  throw new StellarAgentError(
    'CONTRACT_ERROR',
    `Contract returned a malformed ${context} (expected a string)`,
  );
}

export function expectBytes(value: unknown, context: string): Uint8Array {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return new Uint8Array(value);
  throw new StellarAgentError(
    'CONTRACT_ERROR',
    `Contract returned a malformed ${context} (expected bytes)`,
  );
}

/** Decodes a Soroban `Option<T>` field, which `scValToNative` surfaces as `null`/`undefined` when absent. */
export function expectOptional<T>(value: unknown, decode: (value: unknown) => T): T | null {
  return value == null ? null : decode(value);
}

/**
 * Decodes a unit-variant `#[contracttype] enum`, which the Soroban SDK
 * encodes as a one-element symbol vector (e.g. `["PendingRelease"]`).
 * Normalises `PascalCase` to `snake_case` to match the Rust variant's wire
 * name against the lowercase form used throughout the TS/Python SDKs.
 */
export function expectEnumTag(
  value: unknown,
  validVariants: readonly string[],
  context: string,
): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const tag = String(raw).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  if (!validVariants.includes(tag)) {
    throw new StellarAgentError('CONTRACT_ERROR', `Contract returned unknown ${context}: ${String(raw)}`);
  }
  return tag;
}

/** UTF-8 interpretation of a decoded `bytes` field — a business-level choice, not part of the generated shape. */
export function decodeUtf8(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8');
}
