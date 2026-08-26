#!/usr/bin/env tsx
/**
 * Generate the TS and Python struct types the SDKs decode contract results
 * into, from `contracts/specs/*.json` — the on-chain interface extracted
 * straight from each contract's built WASM (see `contracts/generate-specs.sh`).
 *
 * This is the fix for #371: previously `getChannel`/`getJob`/
 * `getRateLimitStatus` hand-decoded each struct field by field, so a field
 * added to (or removed from) a contract struct had nothing telling the SDK —
 * the `ChannelInfo`/`RateLimitStatus` breakages both came from exactly that,
 * surfacing only as a type error much later. Structs are now generated
 * mechanically from the same spec `contracts/generate-specs.sh` extracts, so
 * a shape change shows up as a diff in this script's output, not as a bug
 * report.
 *
 * Two outputs, one source of truth:
 *   - packages/core/src/generated/contract-types.ts — interfaces + decoders,
 *     consumed by packages/core/src/index.ts.
 *   - python/src/stellaragent/generated/contract_types.py — dataclasses only
 *     (the Python SDK has no contract-decode path yet — every `get_*` in
 *     agent.py currently raises `NotImplementedError` — so there is nothing
 *     to migrate onto them yet; they exist so the *shape* is generated from
 *     day one, before a hand-written decoder gets a chance to drift).
 *
 * ```bash
 * pnpm contract-types:generate   # regenerate from contracts/specs/*.json
 * pnpm contract-types:check      # fail if either committed file is stale
 * ```
 *
 * A diff here means a contract struct's shape changed — that is the CI gate
 * from the issue's acceptance criteria: adding a field to a contract struct
 * changes `contracts/specs/*.json` (contracts CI job, `generate-specs.sh
 * --check`), which changes what this script emits, which fails
 * `contract-types:check` until someone runs `contract-types:generate`,
 * reviews the diff, and updates whatever hand-written mapping needs the new
 * field.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPECS_DIR = resolve(REPO_ROOT, 'contracts/specs');
const TS_OUT_PATH = resolve(REPO_ROOT, 'packages/core/src/generated/contract-types.ts');
const PY_OUT_PATH = resolve(REPO_ROOT, 'python/src/stellaragent/generated/contract_types.py');

// ─── Spec JSON shapes (the subset of SCSpecEntry we read) ───────────────────

interface SpecField {
  doc: string;
  name: string;
  type_: SpecType;
}

type SpecType =
  | string // 'address' | 'bool' | 'u32' | 'u64' | 'i128' | 'u128' | 'string' | 'symbol' | 'bytes' | ...
  | { option: { value_type: SpecType } }
  | { udt: { name: string } }
  | { bytes_n: { n: number } }
  | { vec: { element_type: SpecType } }
  | { map: { key_type: SpecType; value_type: SpecType } };

interface SpecEntry {
  udt_struct_v0?: { doc: string; name: string; fields: SpecField[] };
  udt_union_v0?: { doc: string; name: string; cases: Array<{ void_v0?: { doc: string; name: string } }> };
}

// ─── What each contract contributes ──────────────────────────────────────────
//
// Deliberately not "every struct in the contract" — only the ones an SDK
// actually decodes today (see packages/core/src/index.ts's getAgent,
// getChannel, getJob, getRateLimitStatus). A contract with no SDK-facing
// struct (circuit_breaker, price_oracle, amm_swap) has no entry here; add one
// the day an SDK starts decoding one of its structs.

interface WantedType {
  contract: string;
  kind: 'enum' | 'struct';
  name: string;
}

const WANTED: WantedType[] = [
  { contract: 'agent_wallet_factory', kind: 'struct', name: 'AgentInfo' },
  { contract: 'payment_channel', kind: 'enum', name: 'SpendPeriod' },
  { contract: 'payment_channel', kind: 'struct', name: 'Channel' },
  { contract: 'escrow', kind: 'enum', name: 'JobStatus' },
  { contract: 'escrow', kind: 'struct', name: 'Job' },
  { contract: 'rate_limiter', kind: 'struct', name: 'RateLimit' },
];

// ─── Load specs and pull out the wanted entries ─────────────────────────────

interface EnumIR {
  kind: 'enum';
  name: string;
  doc: string;
  variants: string[]; // snake_case, decode-side wire form
}

interface StructIR {
  kind: 'struct';
  name: string;
  doc: string;
  fields: Array<{ name: string; doc: string; type: SpecType }>;
}

type IR = EnumIR | StructIR;

const specCache = new Map<string, SpecEntry[]>();
function loadSpec(contract: string): SpecEntry[] {
  let spec = specCache.get(contract);
  if (!spec) {
    const path = resolve(SPECS_DIR, `${contract}.json`);
    if (!existsSync(path)) {
      throw new Error(`Missing ${path}. Run: cd contracts && ./generate-specs.sh`);
    }
    spec = JSON.parse(readFileSync(path, 'utf8')) as SpecEntry[];
    specCache.set(contract, spec);
  }
  return spec;
}

/** `PendingRelease` -> `pending_release`, matching how the runtime decodes the wire form (see `expectEnumTag`). */
function toSnakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * `stellar contract info interface --output json-formatted` emits doc-comment
 * newlines, quotes, and non-ASCII bytes as literal escape text (e.g. the
 * four characters `\`, `x`, `e`, `2` for one byte of a UTF-8 em dash) rather
 * than real characters or standard JSON escapes — so a JSON parse alone
 * leaves them looking like `\n` and `\xe2\x80\x94` in the resulting string.
 * Undo that before the text lands in a generated comment.
 */
function cleanDoc(doc: string): string {
  let out = doc.replace(/(?:\\x[0-9a-fA-F]{2})+/g, (run) => {
    const bytes = run.match(/[0-9a-fA-F]{2}/g)!.map((hex) => parseInt(hex, 16));
    return Buffer.from(bytes).toString('utf8');
  });
  out = out.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return out;
}

function toConstantCase(name: string): string {
  return toSnakeCase(name).toUpperCase();
}

const ir: IR[] = WANTED.map(({ contract, kind, name }) => {
  const spec = loadSpec(contract);
  if (kind === 'struct') {
    const entry = spec.find((e) => e.udt_struct_v0?.name === name);
    if (!entry?.udt_struct_v0) {
      throw new Error(`No struct '${name}' found in contracts/specs/${contract}.json`);
    }
    const { doc, fields } = entry.udt_struct_v0;
    return {
      kind: 'struct',
      name,
      doc: cleanDoc(doc),
      fields: fields.map((f) => ({ name: f.name, doc: cleanDoc(f.doc), type: f.type_ })),
    } satisfies StructIR;
  }
  const entry = spec.find((e) => e.udt_union_v0?.name === name);
  if (!entry?.udt_union_v0) {
    throw new Error(`No enum '${name}' found in contracts/specs/${contract}.json`);
  }
  const { doc, cases } = entry.udt_union_v0;
  const variants = cases.map((c) => {
    if (!c.void_v0) {
      throw new Error(
        `${name}.${JSON.stringify(c)} is not a unit variant — the generator only supports ` +
          'unit-variant enums today. Extend generate-contract-types.ts before adding a data-carrying variant.',
      );
    }
    return toSnakeCase(c.void_v0.name);
  });
  return { kind: 'enum', name, doc: cleanDoc(doc), variants } satisfies EnumIR;
});

const enumsByName = new Map(ir.filter((t): t is EnumIR => t.kind === 'enum').map((e) => [e.name, e]));

// ─── Type mapping: Soroban spec type -> TS / Python ─────────────────────────

interface MappedType {
  tsType: string;
  /** Given an expression string for the raw value, returns a decode expression string. */
  tsDecode: (expr: string, context: string) => string;
  pyType: string;
}

function mapType(type: SpecType): MappedType {
  if (typeof type === 'string') {
    switch (type) {
      case 'address':
      case 'string':
      case 'symbol':
        return {
          tsType: 'string',
          tsDecode: (expr, ctx) => `expectString(${expr}, '${ctx}')`,
          pyType: 'str',
        };
      case 'bool':
        return {
          tsType: 'boolean',
          tsDecode: (expr, ctx) => `expectBool(${expr}, '${ctx}')`,
          pyType: 'bool',
        };
      case 'u32':
        return {
          tsType: 'number',
          tsDecode: (expr, ctx) => `expectU32(${expr}, '${ctx}')`,
          pyType: 'int',
        };
      case 'u64':
      case 'i64':
      case 'u128':
      case 'i128':
        return {
          tsType: 'bigint',
          tsDecode: (expr, ctx) => `expectBigInt(${expr}, '${ctx}')`,
          pyType: 'int',
        };
      case 'bytes':
        return {
          tsType: 'Uint8Array',
          tsDecode: (expr, ctx) => `expectBytes(${expr}, '${ctx}')`,
          pyType: 'bytes',
        };
      default:
        throw new Error(`Unsupported scalar spec type '${type}' — extend generate-contract-types.ts`);
    }
  }
  if ('option' in type) {
    const inner = mapType(type.option.value_type);
    return {
      tsType: `${inner.tsType} | null`,
      tsDecode: (expr, ctx) => `expectOptional(${expr}, (value) => ${inner.tsDecode('value', ctx)})`,
      pyType: `${inner.pyType} | None`,
    };
  }
  if ('bytes_n' in type) {
    return {
      tsType: 'Uint8Array',
      tsDecode: (expr, ctx) => `expectBytes(${expr}, '${ctx}')`,
      pyType: 'bytes',
    };
  }
  if ('udt' in type) {
    const enumIR = enumsByName.get(type.udt.name);
    if (!enumIR) {
      throw new Error(
        `${type.udt.name} is referenced as a field type but is not in WANTED as an enum — ` +
          'add it to generate-contract-types.ts (only unit-variant enum UDTs are supported today).',
      );
    }
    const rawName = `Raw${enumIR.name}`;
    const variantsConst = `RAW_${toConstantCase(enumIR.name)}_VARIANTS`;
    return {
      tsType: rawName,
      tsDecode: (expr, ctx) => `expectEnumTag(${expr}, ${variantsConst}, '${ctx}') as ${rawName}`,
      pyType: rawName,
    };
  }
  throw new Error(`Unsupported spec type ${JSON.stringify(type)} — extend generate-contract-types.ts`);
}

// ─── Emit TypeScript ─────────────────────────────────────────────────────────

const GENERATED_HEADER = (forLang: 'ts' | 'py') => {
  const comment = forLang === 'ts' ? '//' : '#';
  return [
    `${comment} GENERATED by scripts/generate-contract-types.ts from contracts/specs/*.json.`,
    `${comment} Do not hand-edit — regenerate with \`pnpm contract-types:generate\` and review`,
    `${comment} the diff: it means a contract's #[contracttype] struct or enum changed shape.`,
    `${comment}`,
    `${comment} Field names mirror the on-chain definition exactly (snake_case, including`,
    `${comment} fields no hand-written SDK type surfaces), so a field the contract adds or`,
    `${comment} removes shows up here first — see contracts/generate-specs.sh and #371.`,
  ].join('\n');
};

function tsDoc(doc: string, indent = ''): string {
  if (!doc) return '';
  const lines = doc.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return '';
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
  return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`).join('\n')}\n${indent} */\n`;
}

function emitTypeScript(): string {
  const parts: string[] = [
    GENERATED_HEADER('ts'),
    '',
    "import {",
    '  expectRecord,',
    '  expectBigInt,',
    '  expectU32,',
    '  expectBool,',
    '  expectString,',
    '  expectBytes,',
    '  expectOptional,',
    '  expectEnumTag,',
    "} from '../decode.js';",
    '',
  ];

  for (const node of ir) {
    if (node.kind === 'enum') {
      const variantsConst = `RAW_${toConstantCase(node.name)}_VARIANTS`;
      const rawName = `Raw${node.name}`;
      parts.push(`// ─── ${node.name} ${'─'.repeat(Math.max(1, 74 - node.name.length))}`);
      parts.push('');
      if (node.doc) parts.push(tsDoc(node.doc).trimEnd());
      parts.push(
        `export const ${variantsConst} = [${node.variants.map((v) => `'${v}'`).join(', ')}] as const;`,
      );
      parts.push(`export type ${rawName} = (typeof ${variantsConst})[number];`);
      parts.push('');
      continue;
    }

    const rawName = `Raw${node.name}`;
    parts.push(`// ─── ${node.name} ${'─'.repeat(Math.max(1, 74 - node.name.length))}`);
    parts.push('');
    if (node.doc) parts.push(tsDoc(node.doc).trimEnd());
    parts.push(`export interface ${rawName} {`);
    for (const field of node.fields) {
      const mapped = mapType(field.type);
      if (field.doc) parts.push(tsDoc(field.doc, '  ').trimEnd());
      parts.push(`  ${field.name}: ${mapped.tsType};`);
    }
    parts.push('}');
    parts.push('');
    parts.push(`export function decode${node.name}(value: unknown): ${rawName} {`);
    parts.push(`  const v = expectRecord(value, '${node.name}');`);
    parts.push('  return {');
    for (const field of node.fields) {
      const mapped = mapType(field.type);
      parts.push(`    ${field.name}: ${mapped.tsDecode(`v.${field.name}`, `${node.name}.${field.name}`)},`);
    }
    parts.push('  };');
    parts.push('}');
    parts.push('');
  }

  return `${parts.join('\n').trimEnd()}\n`;
}

// ─── Emit Python ─────────────────────────────────────────────────────────────
//
// Dataclasses only — see the module docstring above for why there is no
// decode function yet.

function pyDoc(doc: string, indent = ''): string {
  if (!doc) return '';
  const lines = doc.split('\n').filter((l) => l.length > 0);
  return lines.map((l) => `${indent}# ${l}`).join('\n');
}

function emitPython(): string {
  const parts: string[] = [
    GENERATED_HEADER('py'),
    '"""Struct types mirroring on-chain #[contracttype] definitions. See the header above."""',
    '',
    'from __future__ import annotations',
    '',
    'from dataclasses import dataclass',
    'from typing import Literal',
    '',
    '__all__ = [',
    ...ir.map((node) => `    "Raw${node.name}",`),
    ']',
    '',
  ];

  for (const node of ir) {
    const rawName = `Raw${node.name}`;
    if (node.kind === 'enum') {
      parts.push(`# ${'─'.repeat(76)}`);
      if (node.doc) parts.push(pyDoc(node.doc));
      const literalArgs = node.variants.map((v) => `"${v}"`).join(', ');
      parts.push(`${rawName} = Literal[${literalArgs}]`);
      parts.push('');
      continue;
    }

    parts.push(`# ${'─'.repeat(76)}`);
    parts.push('@dataclass(frozen=True)');
    parts.push(`class ${rawName}:`);
    if (node.doc) parts.push(pyDoc(node.doc, '    '));
    for (const field of node.fields) {
      const mapped = mapType(field.type);
      if (field.doc) parts.push(pyDoc(field.doc, '    '));
      parts.push(`    ${field.name}: ${mapped.pyType}`);
    }
    parts.push('');
  }

  return `${parts.join('\n').trimEnd()}\n`;
}

// ─── Write or check ──────────────────────────────────────────────────────────

const tsOutput = emitTypeScript();
const pyOutput = emitPython();

function writeOrCheck(path: string, content: string, label: string, stale: string[]): void {
  if (process.argv.includes('--check')) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
      stale.push(label);
    }
    return;
  }
  writeFileSync(path, content);
  console.log(`Wrote ${path}`);
}

if (process.argv.includes('--check')) {
  const stale: string[] = [];
  writeOrCheck(TS_OUT_PATH, tsOutput, TS_OUT_PATH, stale);
  writeOrCheck(PY_OUT_PATH, pyOutput, PY_OUT_PATH, stale);
  if (stale.length > 0) {
    console.error('error: generated contract types are out of date:');
    for (const path of stale) console.error(`  ${path}`);
    console.error('Regenerate with `pnpm contract-types:generate` and review the diff —');
    console.error('it means a contract struct changed shape. Update the SDK decoders to match.');
    process.exit(1);
  }
  console.log('Generated contract types are up to date.');
} else {
  writeOrCheck(TS_OUT_PATH, tsOutput, TS_OUT_PATH, []);
  writeOrCheck(PY_OUT_PATH, pyOutput, PY_OUT_PATH, []);
}
