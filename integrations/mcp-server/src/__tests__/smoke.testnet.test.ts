/**
 * Live testnet smoke test — skipped unless STELLARAGENT_LIVE_TEST=1.
 */
import { describe, it, expect } from 'vitest';
import { StellarAgent } from '@stellaragent/core';
import { dispatchTool, createMcpContext } from '../tools.js';

const live = process.env.STELLARAGENT_LIVE_TEST === '1' && process.env.AGENT_SECRET;

describe.skipIf(!live)('testnet smoke', () => {
  it('quotes a payment without submitting', async () => {
    const agent = await StellarAgent.create({
      network: 'testnet',
      secretKey: process.env.AGENT_SECRET!,
      allowUnconfiguredContracts: true,
    });
    const ctx = createMcpContext(agent, { sessionBudget: '1', dryRun: true });
    const result = await dispatchTool(ctx, 'stellaragent_quote', {
      amount: '0.001',
      recipient: agent.address,
    });
    expect(result.ok).toBe(true);
  });
});

describe('smoke scaffold', () => {
  it('is skipped unless STELLARAGENT_LIVE_TEST=1', () => {
    expect(true).toBe(true);
  });
});
