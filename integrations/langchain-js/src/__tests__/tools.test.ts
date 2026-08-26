import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StellarAgentToolKit, TOOL_NAMES } from '../index.js';
import { ToolError } from '@stellaragent/integration-shared';

describe('StellarAgentToolKit parity', () => {
  const agent = {
    address: 'GAGENT',
    payForAPI: vi.fn(async () => ({ hash: 'tx1', success: true, ledger: 1 })),
    getSpendReport: vi.fn(async () => ({
      spentThisPeriod: '1',
      remainingThisPeriod: '9',
      totalLifetime: '1',
    })),
    getRateLimitStatus: vi.fn(async () => ({ configured: true, active: true })),
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes all MCP tools', () => {
    const kit = new StellarAgentToolKit(agent as never, { sessionBudget: '10' });
    expect(kit.tools.length).toBe(TOOL_NAMES.length);
    expect(kit.tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
  });

  it('quote tool returns wouldBlock without submitting', async () => {
    const kit = new StellarAgentToolKit(agent as never, { sessionBudget: '10' });
    const quote = kit.tools.find((t) => t.name === 'stellaragent_quote')!;
    const result = JSON.parse(await quote.invoke({ amount: '0.1', recipient: 'GRECIP' }));
    expect(result.wouldBlock).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('pay tool refuses over-budget payments with typed error JSON', async () => {
    const kit = new StellarAgentToolKit(agent as never, { sessionBudget: '0.01' });
    const pay = kit.tools.find((t) => t.name === 'stellaragent_pay')!;
    const result = JSON.parse(
      await pay.invoke({
        amount: '1',
        recipient: 'GRECIP',
        endpoint: 'https://api.example.com',
      }),
    );
    expect(result.code).toBe('PAYMENT_REFUSED');
    expect(result.reasons?.length).toBeGreaterThan(0);
  });

  it('dry-run mode skips SDK payForAPI', async () => {
    const kit = new StellarAgentToolKit(agent as never, { sessionBudget: '10', dryRun: true });
    const pay = kit.tools.find((t) => t.name === 'stellaragent_pay')!;
    const result = JSON.parse(
      await pay.invoke({
        amount: '0.1',
        recipient: 'GRECIP',
        endpoint: 'https://api.example.com',
      }),
    );
    expect(result.dryRun).toBe(true);
    expect(agent.payForAPI).not.toHaveBeenCalled();
  });

  it('job lifecycle tools delegate to SDK', async () => {
    const kit = new StellarAgentToolKit(agent as never, { sessionBudget: '10' });
    const create = kit.tools.find((t) => t.name === 'stellaragent_create_job')!;
    const created = JSON.parse(
      await create.invoke({ workerAgent: 'GW', task: 'work', escrowAmount: '0.1' }),
    );
    expect(created.jobId).toBe('7');
    expect(agent.requestWork).toHaveBeenCalled();

    const accept = kit.tools.find((t) => t.name === 'stellaragent_accept_job')!;
    await accept.invoke({ jobId: '7' });
    expect(agent.acceptJob).toHaveBeenCalled();
  });

  it('open channel tool calls SDK openChannel', async () => {
    const kit = new StellarAgentToolKit(agent as never, { sessionBudget: '10' });
    const open = kit.tools.find((t) => t.name === 'stellaragent_open_channel')!;
    const result = JSON.parse(
      await open.invoke({ deposit: '10', limitPerPeriod: '1', period: 'hourly' }),
    );
    expect(result.channelId).toBe('3');
    expect(agent.openChannel).toHaveBeenCalled();
  });
});

describe('StellarAgentToolKit error surface', () => {
  it('surfaces typed ToolError codes to callers', () => {
    const err = new ToolError('PAYMENT_REFUSED', 'blocked', { reasons: ['session_budget_exceeded'] });
    expect(err.toJSON().code).toBe('PAYMENT_REFUSED');
  });
});
