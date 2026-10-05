import type { AggregatedState, DecisionResult, FailureConfig, HealthStatus, ModelInfo } from '@rover/protocol';
import type { DecideOptions, DecisionEngine } from './engine';

/**
 * Decorator that injects malformed AI answers without the wrapped engine or the rest
 * of the system knowing about it. (Timeouts and latency are injected by the AutonomyStack
 * in simulation time, so they stay deterministic.)
 */
export class FaultInjectingDecisionEngine implements DecisionEngine {
  constructor(
    readonly inner: DecisionEngine,
    private readonly failures: () => FailureConfig,
  ) {}

  get id(): string {
    return this.inner.id;
  }

  get deterministic(): boolean | undefined {
    return this.inner.deterministic;
  }

  async decide(state: AggregatedState, opts: DecideOptions): Promise<DecisionResult> {
    const f = this.failures();
    const result = await this.inner.decide(state, opts);
    if (f.aiInvalidResponse) {
      return {
        decision: null,
        latencyMs: result.latencyMs,
        error: { code: 'INVALID_DECISION', message: 'Injected invalid response' },
        raw: { request: result.raw?.request, response: { action: 'FLY_TO_MOON', confidence: 'very', garbage: true } },
      };
    }
    return result;
  }

  healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    return this.inner.healthCheck(signal);
  }

  getModelInfo(): ModelInfo {
    return this.inner.getModelInfo();
  }

  reset(): void {
    this.inner.reset?.();
  }
}
