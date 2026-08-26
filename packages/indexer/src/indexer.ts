import { SorobanRpc } from "@stellar/stellar-sdk";
import { decodeEvent } from "./decoder.js";
import { EventStore } from "./store.js";
import { createIndexerTelemetry, instrumentIndexRun, instrumentDecodedEvent } from "./telemetry.js";
import type { IndexerTelemetry } from "./telemetry.js";
import type {
  ContractAddresses,
  ContractKind,
  DecodedEvent,
  EventSource,
  RawContractEvent,
} from "./types.js";

export interface IndexerOptions {
  rpcUrl?: string;
  source?: EventSource;
  store: EventStore;
  contracts: ContractAddresses;
  startLedger: number;
  rollbackWindow?: number;
  finalityLag?: number;
  pageSize?: number;
  pollIntervalMs?: number;
  allowHttp?: boolean;
  /** Enable tracing and metrics for the ingest pipeline. */
  telemetry?: boolean | { otlpEndpoint?: string; serviceName?: string };
}

export interface IndexResult {
  fromLedger: number;
  throughLedger: number;
  eventCount: number;
}

export class SorobanEventIndexer {
  private readonly source: EventSource;
  private readonly store: EventStore;
  private readonly contracts: ContractAddresses;
  private readonly startLedger: number;
  private readonly rollbackWindow: number;
  private readonly finalityLag: number;
  private readonly pageSize: number;
  private readonly pollIntervalMs: number;
  private readonly telemetry: IndexerTelemetry;
  private stopped = false;

  constructor(options: IndexerOptions) {
    if (!options.source && !options.rpcUrl) {
      throw new Error("rpcUrl is required when source is not provided");
    }
    if (!Number.isSafeInteger(options.startLedger) || options.startLedger < 1) {
      throw new Error("startLedger must be a positive integer");
    }
    this.source =
      options.source ??
      new SorobanRpc.Server(options.rpcUrl!, {
        allowHttp: options.allowHttp ?? options.rpcUrl!.startsWith("http://"),
      });
    this.store = options.store;
    this.contracts = options.contracts;
    this.startLedger = options.startLedger;
    this.rollbackWindow = options.rollbackWindow ?? 12;
    this.finalityLag = options.finalityLag ?? 1;
    this.pageSize = options.pageSize ?? 100;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
    const tel = options.telemetry;
    this.telemetry = createIndexerTelemetry(
      typeof tel === "object" ? { enabled: true, ...tel } : { enabled: tel ?? false },
    );
  }

  async catchUp(fromLedger?: number): Promise<IndexResult> {
    const result = await instrumentIndexRun(this.telemetry, () =>
      this.runOnceInternal(fromLedger),
    );
    return {
      fromLedger: result.fromLedger,
      throughLedger: result.throughLedger,
      eventCount: result.eventCount,
    };
  }

  async runOnce(fromLedgerOverride?: number): Promise<IndexResult> {
    const result = await this.runOnceInternal(fromLedgerOverride);
    return {
      fromLedger: result.fromLedger,
      throughLedger: result.throughLedger,
      eventCount: result.eventCount,
    };
  }

  private async runOnceInternal(fromLedgerOverride?: number): Promise<
    IndexResult & { decodeFailures: number; latestLedger: number }
  > {
    if (
      fromLedgerOverride !== undefined &&
      (!Number.isSafeInteger(fromLedgerOverride) || fromLedgerOverride < 1)
    ) {
      throw new Error("fromLedger must be a positive integer");
    }
    const checkpoint = this.store.checkpoint();
    const fromLedger =
      fromLedgerOverride === undefined
        ? Math.max(
            this.startLedger,
            (checkpoint ?? this.startLedger) - this.rollbackWindow,
          )
        : Math.max(this.startLedger, fromLedgerOverride);
    const filters: SorobanRpc.Api.EventFilter[] = [
      {
        type: "contract",
        contractIds: Object.values(this.contracts),
      },
    ];

    let cursor: string | undefined;
    let latestLedger = fromLedger - 1;
    const rawEvents: RawContractEvent[] = [];
    do {
      const response = await this.source.getEvents({
        filters,
        ...(cursor ? { cursor } : { startLedger: fromLedger }),
        limit: this.pageSize,
      });
      if (latestLedger < fromLedger) latestLedger = response.latestLedger;
      rawEvents.push(...(response.events as RawContractEvent[]));
      cursor =
        response.events.length === this.pageSize
          ? response.events.at(-1)?.pagingToken
          : undefined;
    } while (cursor);

    const throughLedger = Math.max(fromLedger - 1, latestLedger - this.finalityLag);
    let decodeFailures = 0;
    const decoded = rawEvents
      .filter((event) => event.ledger <= throughLedger)
      .map((event) => {
        try {
          return instrumentDecodedEvent(this.telemetry, this.decode(event));
        } catch (error) {
          decodeFailures += 1;
          this.telemetry.logger.warn("decode failure", {
            eventId: event.id,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }
      })
      .filter((event): event is DecodedEvent => event !== null);
    this.store.replaceRange(fromLedger, throughLedger, decoded);
    return {
      fromLedger,
      throughLedger,
      eventCount: decoded.length,
      decodeFailures,
      latestLedger,
    };
  }

  async liveTail(signal?: AbortSignal): Promise<void> {
    this.stopped = false;
    while (!this.stopped && !signal?.aborted) {
      await this.runOnce();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.pollIntervalMs);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  }

  stop(): void {
    this.stopped = true;
  }

  private decode(raw: RawContractEvent): DecodedEvent {
    const address = raw.contractId?.toString();
    const match = Object.entries(this.contracts).find(
      ([, configured]) => configured === address,
    );
    if (!match || !address) {
      throw new Error(`event ${raw.id} came from an unconfigured contract`);
    }
    return decodeEvent(raw, match[0] as ContractKind, address);
  }
}
