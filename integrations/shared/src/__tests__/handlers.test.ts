import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentPolicy } from '../policy.js';
import { ToolError, toolErrorFromRefusal, isToolError } from '../errors.js';
import {
  quotePayment,
  payForApi,
  dispatchToolHandler,
  createToolContext,
} from '../handlers.js';

describe('ToolError', () => {
  it('serializes to JSON for agent consumption', () => {
    const err = toolErrorFromRefusal(['channel_spend_limit']);
    expect(isToolError(err)).toBe(true);
    expect(err.toJSON().code).toBe('PAYMENT_REFUSED');
    expect(err.toJSON().reasons).toEqual(['channel_spend_limit']);
  });
});

describe('dispatchToolHandler', () => {
  const agent = {
    address: 'GAGENT',
    payForAPI: vi.fn(async () => ({ hash: 'tx1', success: true, ledger: 1 })),
    getSpendReport: vi.fn(async () => ({
      spentThisPeriod: '1',
      remainingThisPeriod: '9',
      totalLifetime: '1',
    })),
    getRateLimitStatus: vi.fn(async () => ({ configured: false, active: true })),
    requestWork: vi.fn(async () => 7n),
    acceptJob: vi.fn(async () => ({ hash: 'tx2', success: true })),
    submitResult: vi.fn(async () => ({ hash: 'tx3', success: true })),
    releasePayment: vi.fn(async () => ({ hash: 'tx4', success: true })),
    getJob: vi.fn(async () => ({
      id: 7n,
      status: 'open',
      requester: 'G1',
      worker: null,
      amount: 100n,
      deadlineLedger: 999,
    })),
    openChannel: vi.fn(async () => 3n),
  };

  const ctx = createToolContext(agent as never, { sessionBudget: '10' }, 100);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('quotes without submitting', async () => {
    const result = await quotePayment(ctx, { amount: '0.1', recipient: 'GRECIP' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.wouldBlock).toBe(false);
  });

  it('refuses over-budget payments with typed error', async () => {
    const tight = createToolContext(agent as never, { sessionBudget: '0.01' }, 100);
    const result = await payForApi(tight, {
      amount: '1',
      recipient: 'GRECIP',
      endpoint: 'https://api.example.com',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(ToolError);
  });

  it('supports full job lifecycle tools', async () => {
    expect((await dispatchToolHandler(ctx, 'stellaragent_create_job', {
      workerAgent: 'GWORKER',
      task: 'do work',
      escrowAmount: '0.1',
    })).ok).toBe(true);

    expect((await dispatchToolHandler(ctx, 'stellaragent_accept_job', { jobId: '7' })).ok).toBe(true);
    expect((await dispatchToolHandler(ctx, 'stellaragent_submit_job_result', {
      jobId: '7',
      result: 'done',
    })).ok).toBe(true);
    expect((await dispatchToolHandler(ctx, 'stellaragent_release_job', { jobId: '7' })).ok).toBe(true);
    expect((await dispatchToolHandler(ctx, 'stellaragent_get_job', { jobId: '7' })).ok).toBe(true);
  });

  it('dry-run pays without calling SDK', async () => {
    const dry = createToolContext(agent as never, { sessionBudget: '10', dryRun: true }, 100);
    await payForApi(dry, {
      amount: '0.1',
      recipient: 'GRECIP',
      endpoint: 'https://api.example.com',
    });
    expect(agent.payForAPI).not.toHaveBeenCalled();
  });

  it('returns channel status and rate limits', async () => {
    const status = await dispatchToolHandler(ctx, 'stellaragent_channel_status', {});
    expect(status.ok).toBe(true);
    if (status.ok) expect(status.data.remainingThisPeriod).toBe('9');

    const limits = await dispatchToolHandler(ctx, 'stellaragent_rate_limits', {});
    expect(limits.ok).toBe(true);
  });

  it('opens payment channel via SDK', async () => {
    const result = await dispatchToolHandler(ctx, 'stellaragent_open_channel', {
      deposit: '10',
      limitPerPeriod: '1',
      period: 'hourly',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.channelId).toBe('3');
    expect(agent.openChannel).toHaveBeenCalled();
  });

  it('rejects unknown tools with typed error', async () => {
    const result = await dispatchToolHandler(ctx, 'stellaragent_unknown', {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNKNOWN_TOOL');
  });

  it('blocks tool results that would expose secret keys', async () => {
    const leaky = createToolContext(
      {
        ...agent,
        getSpendReport: vi.fn(async () => ({
          spentThisPeriod: 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          remainingThisPeriod: '9',
          totalLifetime: '1',
        })),
      } as never,
      { sessionBudget: '10' },
      100,
    );
    await expect(dispatchToolHandler(leaky, 'stellaragent_channel_status', {})).rejects.toThrow(
      ToolError,
    );
  });
});

describe('PaymentPolicy prompt injection', () => {
  it('ignores hostile budget hints', () => {
    const policy = new PaymentPolicy({ sessionBudget: '1.0' });
    policy.applyExternalBudgetHint('999999');
    policy.recordAttempt('pay', { amount: '0.8', recipient: 'G', currentLedger: 1 });
    const decision = policy.evaluate({ amount: '0.5', recipient: 'G', currentLedger: 2 });
    expect(decision.allowed).toBe(false);
  });
});
