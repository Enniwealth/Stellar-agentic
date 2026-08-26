/** Log levels supported by the StellarAgent logger. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  level: LogLevel;
  message: string;
  attributes?: Record<string, unknown>;
  timestamp?: number;
}

export interface Logger {
  debug(message: string, attributes?: Record<string, unknown>): void;
  info(message: string, attributes?: Record<string, unknown>): void;
  warn(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;
}

/** Patterns that must never reach an exporter or log sink. */
const REDACTION_PATTERNS: RegExp[] = [
  /\bS[A-Z2-7]{55}\b/g,
  /\bsecret[_-]?key["'\s:=]+["']?[A-Za-z0-9+/=]{20,}/gi,
  /-----BEGIN [A-Z ]+ KEY-----[\s\S]*?-----END [A-Z ]+ KEY-----/g,
  /\bauthEntryXdr["'\s:=]+["']?[A-Za-z0-9+/=]{32,}/gi,
  /\bsignAuthEntry\([^)]*\)/gi,
];

const REDACTED = '[REDACTED]';

function redactString(value: string): string {
  let out = value;
  for (const pattern of REDACTION_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/secret|private.?key|seed|mnemonic|auth/i.test(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redactValue(v);
      }
    }
    return out;
  }
  return value;
}

export function redactForExport(value: unknown): unknown {
  return redactValue(value);
}

export interface LoggerOptions {
  sink?: (record: LogRecord) => void;
  minLevel?: LogLevel;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class RedactingLogger implements Logger {
  private readonly sink: (record: LogRecord) => void;
  private readonly minLevel: LogLevel;

  constructor(options: LoggerOptions = {}) {
    this.sink = options.sink ?? (() => undefined);
    this.minLevel = options.minLevel ?? 'info';
  }

  debug(message: string, attributes?: Record<string, unknown>): void {
    this.emit('debug', message, attributes);
  }

  info(message: string, attributes?: Record<string, unknown>): void {
    this.emit('info', message, attributes);
  }

  warn(message: string, attributes?: Record<string, unknown>): void {
    this.emit('warn', message, attributes);
  }

  error(message: string, attributes?: Record<string, unknown>): void {
    this.emit('error', message, attributes);
  }

  private emit(level: LogLevel, message: string, attributes?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    this.sink({
      level,
      message: redactString(message),
      attributes: attributes
        ? (redactValue(attributes) as Record<string, unknown>)
        : undefined,
      timestamp: Date.now(),
    });
  }
}

/** Zero-cost logger used when telemetry is not configured. */
export const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
