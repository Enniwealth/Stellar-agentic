/**
 * Optional OpenTelemetry bridge — only loaded when telemetry is enabled and
 * the consumer has installed @opentelemetry/* packages.
 */
import type { Tracer } from './tracer.js';
import type { Metrics } from './metrics.js';

export interface OtelBridgeOptions {
  serviceName: string;
  otlpEndpoint: string;
}

export async function createOtelBridge(
  options: OtelBridgeOptions,
): Promise<{ tracer: Tracer; metrics: Metrics }> {
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
  const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http');
  const { PeriodicExportingMetricReader } = await import('@opentelemetry/sdk-metrics');
  const { trace, metrics } = await import('@opentelemetry/api');
  const { Resource } = await import('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME } = await import('@opentelemetry/semantic-conventions');

  const sdk = new NodeSDK({
    resource: new Resource({ [ATTR_SERVICE_NAME]: options.serviceName }),
    traceExporter: new OTLPTraceExporter({ url: `${options.otlpEndpoint}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${options.otlpEndpoint}/v1/metrics` }),
      exportIntervalMillis: 10_000,
    }),
  });
  sdk.start();

  const otelTracer = trace.getTracer('stellaragent');
  const meter = metrics.getMeter('stellaragent');

  const histograms = new Map<string, ReturnType<typeof meter.createHistogram>>();
  const counters = new Map<string, ReturnType<typeof meter.createCounter>>();

  const tracer: Tracer = {
    startSpan(name, attributes = {}) {
      const span = otelTracer.startSpan(name, { attributes });
      return {
        setAttribute(key, value) {
          span.setAttribute(key, value);
        },
        setAttributes(attrs) {
          span.setAttributes(attrs);
        },
        recordException(error) {
          span.recordException(error instanceof Error ? error : new Error(String(error)));
        },
        end() {
          span.end();
        },
      };
    },
    startActiveSpan(name, attributes, fn) {
      return otelTracer.startActiveSpan(name, { attributes: attributes ?? {} }, (span) => {
        const wrapped = {
          setAttribute(key: string, value: string | number | boolean) {
            span.setAttribute(key, value);
          },
          setAttributes(attrs: Record<string, string | number | boolean>) {
            span.setAttributes(attrs);
          },
          recordException(error: unknown) {
            span.recordException(error instanceof Error ? error : new Error(String(error)));
          },
          end() {
            span.end();
          },
        };
        return fn(wrapped);
      });
    },
  };

  const bridgeMetrics: Metrics = {
    recordHistogram(name, value, attributes) {
      let h = histograms.get(name);
      if (!h) {
        h = meter.createHistogram(name);
        histograms.set(name, h);
      }
      h.record(value, attributes);
    },
    incrementCounter(name, delta = 1, attributes) {
      let c = counters.get(name);
      if (!c) {
        c = meter.createCounter(name);
        counters.set(name, c);
      }
      c.add(delta, attributes);
    },
  };

  return { tracer, metrics: bridgeMetrics };
}
