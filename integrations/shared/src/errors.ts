import type { PolicyBlockReason } from './policy.js';

/** Stable error codes returned by framework adapters (MCP, LangChain, LlamaIndex). */
export type ToolErrorCode =
  | 'PAYMENT_REFUSED'
  | 'POLICY_VIOLATION'
  | 'DRY_RUN'
  | 'SDK_ERROR'
  | 'INVALID_ARGUMENT'
  | 'UNKNOWN_TOOL'
  | 'KEY_MATERIAL_BLOCKED';

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly reasons?: PolicyBlockReason[];
  readonly retryable: boolean;

  constructor(
    code: ToolErrorCode,
    message: string,
    options: { reasons?: PolicyBlockReason[]; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.reasons = options.reasons;
    this.retryable = options.retryable ?? false;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      reasons: this.reasons,
      retryable: this.retryable,
    };
  }
}

export function toolErrorFromRefusal(reasons: PolicyBlockReason[]): ToolError {
  return new ToolError(
    'PAYMENT_REFUSED',
    `Payment refused: ${reasons.join(', ')}`,
    { reasons, retryable: false },
  );
}

export function isToolError(error: unknown): error is ToolError {
  return error instanceof ToolError;
}
