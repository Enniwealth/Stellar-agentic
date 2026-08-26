/**
 * Example: pay for an API call using shared handlers (same as MCP).
 */
import { StellarAgent } from '@stellaragent/core';
import { createToolContext, dispatchToolHandler, toMcpResult } from '@stellaragent/integration-shared';

async function main(): Promise<void> {
  const agent = await StellarAgent.create({
    network: 'testnet',
    secretKey: process.env.AGENT_SECRET,
    allowUnconfiguredContracts: true,
    telemetry: process.env.OTLP_ENDPOINT
      ? { enabled: true, otlpEndpoint: process.env.OTLP_ENDPOINT }
      : undefined,
  });

  const ctx = createToolContext(agent, {
    sessionBudget: process.env.SESSION_BUDGET ?? '1.0',
    dryRun: process.env.DRY_RUN === 'true',
  });

  const quote = toMcpResult(
    await dispatchToolHandler(ctx, 'stellaragent_quote', {
      amount: '0.001',
      recipient: process.env.API_PROVIDER ?? agent.address,
    }),
  );
  console.log('Quote:', quote);

  if (quote.ok && !(quote.data as { wouldBlock?: boolean }).wouldBlock) {
    const pay = toMcpResult(
      await dispatchToolHandler(ctx, 'stellaragent_pay', {
        amount: '0.001',
        recipient: process.env.API_PROVIDER ?? agent.address,
        endpoint: 'https://api.example.com/inference',
      }),
    );
    console.log('Payment:', pay);
    console.log('Audit:', ctx.policy.auditLog);
  }
}

main().catch(console.error);
