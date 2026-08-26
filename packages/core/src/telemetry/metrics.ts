export interface HistogramRecord {
  name: string;
  value: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface CounterRecord {
  name: string;
  delta: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface Metrics {
  recordHistogram(name: string, value: number, attributes?: Record<string, string | number | boolean>): void;
  incrementCounter(name: string, delta?: number, attributes?: Record<string, string | number | boolean>): void;
}

export const noopMetrics: Metrics = {
  recordHistogram: () => undefined,
  incrementCounter: () => undefined,
};

/** In-memory metrics recorder for tests. */
export class InMemoryMetrics implements Metrics {
  readonly histograms: HistogramRecord[] = [];
  readonly counters: CounterRecord[] = [];

  recordHistogram(
    name: string,
    value: number,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    this.histograms.push({ name, value, attributes });
  }

  incrementCounter(
    name: string,
    delta = 1,
    attributes?: Record<string, string | number | boolean>,
  ): void {
    this.counters.push({ name, delta, attributes });
  }
}
