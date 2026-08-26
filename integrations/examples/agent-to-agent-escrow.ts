/**
 * Example: agent-to-agent escrow through shared handlers.
 */
import { StellarAgent } from '@stellaragent/core';
import { createToolContext, dispatchToolHandler, toMcpResult } from '@stellaragent/integration-shared';

async function main(): Promise<void> {
  const agent = await StellarAgent.create({
    network: 'testnet',
    secretKey: process.env.AGENT_SECRET,
    allowUnconfiguredContracts: true,
  });

  const ctx = createToolContext(agent, {
    sessionBudget: process.env.SESSION_BUDGET ?? '5.0',
    dryRun: process.env.DRY_RUN === 'true',
  });

  for (const [tool, args] of [
    ['stellaragent_create_job', {
      workerAgent: process.env.WORKER_AGENT ?? agent.address,
      task: 'Summarize document ipfs://QmExample',
      escrowAmount: '0.05',
    }],
    ['stellaragent_accept_job', { jobId: '1' }],
    ['stellaragent_submit_job_result', { jobId: '1', result: 'summary complete' }],
    ['stellaragent_release_job', { jobId: '1' }],
  ] as const) {
    console.log(tool, toMcpResult(await dispatchToolHandler(ctx, tool, args as Record<string, string>)));
  }

  console.log('Audit trail:', ctx.policy.auditLog);
}

main().catch(console.error);
