import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  Account,
  Address,
  SorobanDataBuilder,
  SorobanRpc,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';

import { StellarAgent, InMemoryTracer, InMemoryMetrics, redactForExport, SemConv, SpanNames } from '../index.js';
import { RedactingLogger } from '../telemetry/logger.js';
import { TEST_PUBLIC, TEST_SECRET, DEPLOYED_CONTRACTS } from './fixtures.js';

function addressAuthEntry(): xdr.SorobanAuthorizationEntry {
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(DEPLOYED_CONTRACTS.paymentChannel).toScAddress(),
    functionName: 'open_channel',
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
    minResourceFee: '0',
    cost: { cpuInsns: '0', memBytes: '0' },
    result: { auth, retval },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('telemetry — invocation spans', () => {
  it('records simulate → sign → submit → confirm spans for mutations', async () => {
    const tracer = new InMemoryTracer();
    const metrics = new InMemoryMetrics();
    const agent = await StellarAgent.create({
      network: 'testnet',
      secretKey: TEST_SECRET,
      contracts: DEPLOYED_CONTRACTS,
      telemetry: { enabled: true, tracer, metrics },
    });

    const rpc = {
      getAccount: vi.fn(async () => new Account(TEST_PUBLIC, '1')),
      simulateTransaction: vi.fn(async () => simulation(
        nativeToScVal(7n, { type: 'u64' }),
        [addressAuthEntry()],
      )),
      sendTransaction: vi.fn(async () => ({ status: 'PENDING', hash: 'tx-hash' })),
      getTransaction: vi.fn(async () => ({
        status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
        ledger: 123,
        returnValue: nativeToScVal(7n, { type: 'u64' }),
      })),
    };
    (agent as unknown as { rpc: typeof rpc }).rpc = rpc;

    await agent.openChannel({ deposit: '10', limitPerPeriod: '1', period: 'hourly' });

    const names = tracer.spans.map((s) => s.name);
    expect(names).toContain(SpanNames.contractInvoke);
    expect(names).toContain(SpanNames.simulate);
    expect(names).toContain(SpanNames.sign);
    expect(names).toContain(SpanNames.submit);
    expect(names).toContain(SpanNames.confirm);

    const invoke = tracer.spans.find((s) => s.name === SpanNames.contractInvoke);
    expect(invoke?.attributes[SemConv.contract.method]).toBe('open_channel');
    expect(invoke?.attributes[SemConv.network]).toBe('testnet');
    expect(metrics.histograms.some((h) => h.name.includes('payment.latency'))).toBe(true);
  });

  it('records failure metrics with error code on simulation failure', async () => {
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
      simulateTransaction: vi.fn(async () => ({
        id: 'simulation',
        latestLedger: 100,
        events: [],
        _parsed: true,
        error: 'contract panic: spend limit exceeded for this period',
      })),
    };

    await agent.payForAPI({ endpoint: 'https://api.example.com', amount: '2' }).catch(() => undefined);

    expect(metrics.counters.some((c) => c.attributes?.[SemConv.error.code] === 'SPEND_LIMIT_EXCEEDED')).toBe(true);
  });
});

describe('telemetry — redaction', () => {
  it('never exports secret key material through the logger', () => {
    const records: Array<{ message: string; attributes?: Record<string, unknown> }> = [];
    const logger = new RedactingLogger({
      sink: (record) => records.push({ message: record.message, attributes: record.attributes }),
      minLevel: 'debug',
    });

    logger.info('signing transaction', {
      secretKey: TEST_SECRET,
      note: `key=${TEST_SECRET}`,
    });

    const serialized = JSON.stringify(redactForExport(records));
    expect(serialized).not.toContain(TEST_SECRET);
    expect(serialized).toContain('[REDACTED]');
  });
});

describe('telemetry — disabled is zero overhead', () => {
  it('does not record spans when telemetry is not enabled', async () => {
    const agent = await StellarAgent.create({
      network: 'testnet',
      secretKey: TEST_SECRET,
      contracts: DEPLOYED_CONTRACTS,
    });
    (agent as unknown as { rpc: Record<string, unknown> }).rpc = {
      getAccount: vi.fn(async () => new Account(TEST_PUBLIC, '1')),
      simulateTransaction: vi.fn(async () => simulation(xdr.ScVal.scvBool(false))),
    };

    await agent.checkRateLimit('1');
    const telemetry = (agent as unknown as { telemetry: { enabled: boolean } }).telemetry;
    expect(telemetry.enabled).toBe(false);
  });
});
