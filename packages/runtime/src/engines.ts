import type { AiProvider, AppConfig } from '@rover/protocol';
import { FaultInjectingDecisionEngine, MockDecisionEngine, type DecisionEngine } from '@rover/decision-engine';
import { CustomHttpAdapter, LocalJevAdapter } from '@rover/jev-adapter';

/** Builds the decision engine for a provider, wrapped with failure injection. */
export function createDecisionEngine(provider: AiProvider, config: () => AppConfig): DecisionEngine {
  let inner: DecisionEngine;
  switch (provider) {
    case 'local-jev':
      inner = new LocalJevAdapter(() => config().ai);
      break;
    case 'custom-http':
      inner = new CustomHttpAdapter(() => config().ai);
      break;
    default:
      inner = new MockDecisionEngine();
  }
  return new FaultInjectingDecisionEngine(inner, () => config().failures);
}
