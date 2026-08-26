import { describe, expect, it } from 'vitest';

import {
  decodeAgentInfo,
  decodeChannel,
  decodeJob,
  decodeRateLimit,
} from '../generated/contract-types.js';
import { StellarAgentError } from '../errors.js';

/**
 * These decoders are generated (see scripts/generate-contract-types.ts) from
 * contracts/specs/*.json, which is itself extracted from the built contract
 * WASM. They intentionally decode the *entire* on-chain struct, including
 * fields no hand-written SDK type surfaces (e.g. `Channel.collateral`) — that
 * is the #371 fix: a struct missing a field the contract now returns is a
 * decode-time error here, not a silently wrong `ChannelInfo`.
 */

const VALID_CHANNEL = {
  active: true,
  agent: 'GAGENT',
  allocated: 0n,
  collateral: 100n,
  dispute_ledgers: 17280,
  limit_per_period: 50n,
  owner: 'GOWNER',
  period: ['Hourly'],
  period_start_ledger: 700,
  spent_this_period: 10n,
  token: 'GTOKEN',
  total_spent: 20n,
  voucher_signer: null,
};

describe('generated contract-type decoders', () => {
  it('decodeAgentInfo decodes every field', () => {
    expect(decodeAgentInfo({
      active: true,
      address: 'GADDR',
      created_at: 1,
      name: 'agent',
      owner: 'GOWNER',
      total_ops: 3n,
    })).toEqual({
      active: true,
      address: 'GADDR',
      created_at: 1,
      name: 'agent',
      owner: 'GOWNER',
      total_ops: 3n,
    });
  });

  it('decodeChannel decodes the full struct, including fields no ChannelInfo field surfaces', () => {
    expect(decodeChannel(VALID_CHANNEL)).toEqual({
      ...VALID_CHANNEL,
      period: 'hourly',
      voucher_signer: null,
    });
  });

  it('decodeChannel decodes a present voucher_signer', () => {
    const signer = new Uint8Array(32).fill(7);
    expect(decodeChannel({ ...VALID_CHANNEL, voucher_signer: signer }).voucher_signer).toEqual(signer);
  });

  // The exact regression #371 describes: a contract struct gaining a field
  // is not what this guards (that is contracts/generate-specs.sh --check plus
  // contract-types:check regenerating this file) — this guards the other
  // direction, a field silently *missing* from what the RPC actually returned.
  it('decodeChannel rejects a struct missing a field the contract added', () => {
    const missingCollateral: Record<string, unknown> = { ...VALID_CHANNEL };
    delete missingCollateral.collateral;
    expect(() => decodeChannel(missingCollateral)).toThrow(StellarAgentError);
    expect(() => decodeChannel(missingCollateral)).toThrow(/Channel\.collateral/);
  });

  it('decodeChannel rejects an unknown SpendPeriod variant', () => {
    expect(() => decodeChannel({ ...VALID_CHANNEL, period: ['Weekly'] })).toThrow(StellarAgentError);
  });

  it('decodeJob decodes optional fields both present and absent', () => {
    const base = {
      amount: 25n,
      arbiter: null,
      created_at: 8,
      deadline_ledger: 99,
      dispute_deadline_ledger: null,
      requester: 'GREQ',
      result: null,
      status: ['Open'],
      task_description: Buffer.from('task'),
      token: 'GTOKEN',
      worker: null,
    };
    expect(decodeJob(base)).toMatchObject({ status: 'open', arbiter: null, worker: null, result: null });

    const full = {
      ...base,
      arbiter: 'GARB',
      dispute_deadline_ledger: 200,
      result: Buffer.from('done'),
      status: ['Disputed'],
      worker: 'GWORKER',
    };
    expect(decodeJob(full)).toMatchObject({
      status: 'disputed',
      arbiter: 'GARB',
      worker: 'GWORKER',
      dispute_deadline_ledger: 200,
    });
  });

  it('decodeRateLimit decodes the full struct', () => {
    const raw = {
      active: true,
      agent: 'GAGENT',
      daily_spend: 1n,
      day_window_start: 2,
      hour_window_start: 3,
      hourly_spend: 4n,
      hourly_tx_count: 5,
      max_per_day: 6n,
      max_per_hour: 7n,
      max_per_tx: 8n,
      max_txs_per_hour: 9,
      owner: 'GOWNER',
    };
    expect(decodeRateLimit(raw)).toEqual(raw);
  });

  it('every decoder rejects a non-record value', () => {
    for (const decode of [decodeAgentInfo, decodeChannel, decodeJob, decodeRateLimit]) {
      expect(() => decode(null)).toThrow(StellarAgentError);
      expect(() => decode('not a record')).toThrow(StellarAgentError);
    }
  });
});
