import type { AggregatedState, DecisionResult, HealthStatus, ModelInfo } from '@rover/protocol';

export interface DecideOptions {
  /** Aborted when the autonomy stack times out the request. */
  signal: AbortSignal;
}

/**
 * Provider-independent decision model interface. The rest of the system only knows this.
 * Implementations must never throw from decide(); errors are reported in the result.
 */
export interface DecisionEngine {
  readonly id: string;
  /**
   * True for in-process engines that answer instantly and deterministically (e.g. the mock).
   * The autonomy stack then awaits them inside the tick, which keeps seeded runs bit-exact.
   */
  readonly deterministic?: boolean;
  decide(state: AggregatedState, opts: DecideOptions): Promise<DecisionResult>;
  healthCheck(signal?: AbortSignal): Promise<HealthStatus>;
  getModelInfo(): ModelInfo;
  /** Clears internal memory (called on simulation reset). */
  reset?(): void;
}
