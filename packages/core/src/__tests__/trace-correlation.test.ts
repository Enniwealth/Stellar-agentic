import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  Account,
  Address,
  SorobanDataBuilder,
  SorobanRpc,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';

import {
  StellarAgent,
  InMemoryTracer,
  InMemoryMetrics,
  lookupPaymentIdByTxHash,
  clearPaymentTraceRegistry,
  SemConv,
  SpanNames,
} from '../index.js';
import { TEST_PUBLIC, TEST_SECRET, DEPLOYED_CONTRACTS } from './fixtures.js';

function addressAuthEntry(): xdr.SorobanAuthorizationEntry {
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(DEPLOYED_CONTRACTS.paymentChannel).toScAddress(),
    functionName: 'pay',
    args: [],
  });
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(TEST_PUBLIC).toScAddress(),
        nonce: xdr.Int64.fromString('1'),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction
        .sorobanAuthorizedFunctionTypeContractFn(invokeArgs),
      subInvocations: [],
    }),
  });
}

function simulation(retval: xdr.ScVal, auth: xdr.SorobanAuthorizationEntry[] = []) {
  return {
    id: 'simulation',
    latestLedger: 100,
    events: [],
    _parsed: true,
    transactionData: new SorobanDataBuilder(),
    minResourceFee: '12500',
    cost: { cpuInsns: '0', memBytes: '0' },
    result: { auth, retval },
  };
}

afterEach(() => {
  clearPaymentTraceRegistry();
  vi.restoreAllMocks();
});

describe('trace correlation', () => {
  it('registers payment_id on invoke and links to tx hash for indexer lookup', async () => {
    const tracer = new InMemoryTracer();
    const metrics = new InMemoryMetrics();
    const agent = await StellarAgent.create({
      network: 'testnet',
      secretKey: TEST_SECRET,
      contracts: DEPLOYED_CONTRACTS,
      telemetry: { enabled: true, tracer, metrics },
    });

    (agent as unknown as { activeChannelId?: bigint }).activeChannelId = 1n;
    (agent as unknown as { rpc: Record<string, unknown> }).rpc = {
      getAccount: vi.fn(async () => new Account(TEST_PUBLIC, '1')),
      simulateTransaction: vi.fn(async () => simulation(xdr.ScVal.scvVoid(), [addressAuthEntry()])),
      sendTransaction: vi.fn(async () => ({ status: 'PENDING', hash: 'correlation-tx-hash' })),
      getTransaction: vi.fn(async () => ({
        status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
        ledger: 200,
      })),
    };

    await agent.payForAPI({ endpoint: 'https://api.example.com', amount: '0.01' });

    const invoke = tracer.spans.find((s) => s.name === SpanNames.contractInvoke);
    expect(invoke?.attributes[SemConv.trace.paymentId]).toBeDefined();

    const paymentId = invoke!.attributes[SemConv.trace.paymentId] as string;
    expect(lookupPaymentIdByTxHash('correlation-tx-hash')).toBe(paymentId);
  });

  it('records fee metrics from simulation minResourceFee on mutations', async () => {
    const tracer = new InMemoryTracer();
    const metrics = new InMemoryMetrics();
    const agent = await StellarAgent.create({
      network: 'testnet',
      secretKey: TEST_SECRET,
      contracts: DEPLOYED_CONTRACTS,
      telemetry: { enabled: true, tracer, metrics },
    });

    (agent as unknown as { rpc: Record<string, unknown> }).rpc = {
      getAccount: vi.fn(async () => new Account(TEST_PUBLIC, '1')),
      simulateTransaction: vi.fn(async () => simulation(nativeToScVal(7n, { type: 'u64' }), [addressAuthEntry()])),
      sendTransaction: vi.fn(async () => ({ status: 'PENDING', hash: 'fee-tx' })),
      getTransaction: vi.fn(async () => ({
        status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
        ledger: 1,
        returnValue: nativeToScVal(7n, { type: 'u64' }),
      })),
    };

    await agent.openChannel({ deposit: '10', limitPerPeriod: '1', period: 'hourly' });
    expect(metrics.histograms.some((h) => h.name.includes('fees_stroops'))).toBe(true);
  });
});
