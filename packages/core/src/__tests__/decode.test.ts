import { describe, expect, it } from 'vitest';

import {
  expectRecord,
  expectBigInt,
  expectU32,
  expectBool,
  expectString,
  expectBytes,
  expectOptional,
  expectEnumTag,
  decodeUtf8,
} from '../decode.js';
import { StellarAgentError } from '../errors.js';

describe('decode helpers', () => {
  it('expectRecord accepts plain objects and Maps, rejects everything else', () => {
    expect(expectRecord({ a: 1 }, 'X')).toEqual({ a: 1 });
    expect(expectRecord(new Map([['a', 1]]), 'X')).toEqual({ a: 1 });
    for (const bad of [null, undefined, 1, 'x', [1, 2]]) {
      expect(() => expectRecord(bad, 'X')).toThrow(StellarAgentError);
    }
  });

  it('expectBigInt accepts bigint, safe number, and { value } wrappers', () => {
    expect(expectBigInt(5n, 'X')).toBe(5n);
    expect(expectBigInt(5, 'X')).toBe(5n);
    expect(expectBigInt({ value: 5n }, 'X')).toBe(5n);
    expect(() => expectBigInt('5', 'X')).toThrow(StellarAgentError);
    expect(() => expectBigInt(1.5, 'X')).toThrow(StellarAgentError);
  });

  it('expectU32 accepts a safe number or bigint, rejects the rest', () => {
    expect(expectU32(5, 'X')).toBe(5);
    expect(expectU32(5n, 'X')).toBe(5);
    expect(() => expectU32(1.5, 'X')).toThrow(StellarAgentError);
    expect(() => expectU32('5', 'X')).toThrow(StellarAgentError);
  });

  it('expectBool only accepts real booleans', () => {
    expect(expectBool(true, 'X')).toBe(true);
    expect(() => expectBool(1, 'X')).toThrow(StellarAgentError);
    expect(() => expectBool('true', 'X')).toThrow(StellarAgentError);
  });

  it('expectString accepts strings and stringifiable objects (e.g. Address)', () => {
    expect(expectString('GABC', 'X')).toBe('GABC');
    expect(expectString({ toString: () => 'GABC' }, 'X')).toBe('GABC');
    expect(() => expectString(1, 'X')).toThrow(StellarAgentError);
    expect(() => expectString(null, 'X')).toThrow(StellarAgentError);
  });

  it('expectBytes accepts Buffer/Uint8Array only', () => {
    expect(expectBytes(Buffer.from('hi'), 'X')).toEqual(new Uint8Array(Buffer.from('hi')));
    expect(expectBytes(new Uint8Array([1, 2]), 'X')).toEqual(new Uint8Array([1, 2]));
    expect(() => expectBytes('hi', 'X')).toThrow(StellarAgentError);
  });

  it('expectOptional passes null/undefined through and decodes otherwise', () => {
    expect(expectOptional(null, (v) => v)).toBeNull();
    expect(expectOptional(undefined, (v) => v)).toBeNull();
    expect(expectOptional('x', (v) => expectString(v, 'X'))).toBe('x');
  });

  it('expectEnumTag normalises PascalCase and a one-element symbol vector alike', () => {
    const variants = ['open', 'in_progress', 'pending_release'] as const;
    expect(expectEnumTag(['PendingRelease'], variants, 'X')).toBe('pending_release');
    expect(expectEnumTag('InProgress', variants, 'X')).toBe('in_progress');
    expect(() => expectEnumTag(['Bogus'], variants, 'X')).toThrow(StellarAgentError);
  });

  it('decodeUtf8 round-trips text through bytes', () => {
    expect(decodeUtf8(new Uint8Array(Buffer.from('hello', 'utf8')))).toBe('hello');
  });
});
