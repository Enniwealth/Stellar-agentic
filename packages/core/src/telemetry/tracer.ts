import type { SemanticAttributes } from './semantic.js';

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(attrs: SemanticAttributes): void;
  recordException(error: unknown): void;
  end(): void;
}

export interface Tracer {
  startSpan(name: string, attributes?: SemanticAttributes): Span;
  startActiveSpan<T>(
    name: string,
    attributes: SemanticAttributes | undefined,
    fn: (span: Span) => T | Promise<T>,
  ): T | Promise<T>;
}

class NoopSpan implements Span {
  setAttribute(): void {
    return undefined;
  }
  setAttributes(): void {
    return undefined;
  }
  recordException(): void {
    return undefined;
  }
  end(): void {
    return undefined;
  }
}

export const noopTracer: Tracer = {
  startSpan: () => new NoopSpan(),
  startActiveSpan: (_name, _attrs, fn) => fn(new NoopSpan()),
};

/** In-memory span recorder for tests — no OpenTelemetry dependency. */
export interface RecordedSpan {
  name: string;
  attributes: SemanticAttributes;
  exceptions: unknown[];
  ended: boolean;
}

export class InMemoryTracer implements Tracer {
  readonly spans: RecordedSpan[] = [];

  startSpan(name: string, attributes: SemanticAttributes = {}): Span {
    const record: RecordedSpan = {
      name,
      attributes: { ...attributes },
      exceptions: [],
      ended: false,
    };
    this.spans.push(record);
    return {
      setAttribute: (key, value) => {
        record.attributes[key] = value;
      },
      setAttributes: (attrs) => Object.assign(record.attributes, attrs),
      recordException: (error) => {
        record.exceptions.push(error);
      },
      end: () => {
        record.ended = true;
      },
    };
  }

  startActiveSpan<T>(
    name: string,
    attributes: SemanticAttributes | undefined,
    fn: (span: Span) => T | Promise<T>,
  ): T | Promise<T> {
    const span = this.startSpan(name, attributes);
    try {
      const result = fn(span);
      if (result instanceof Promise) {
        return result.finally(() => span.end());
      }
      span.end();
      return result;
    } catch (error) {
      span.recordException(error);
      span.end();
      throw error;
    }
  }
}
