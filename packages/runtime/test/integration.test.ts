import { describe, expect, it } from 'vitest';
import { TOPICS, createDefaultConfig, type AppConfig, type Twist } from '@rover/protocol';
import { getPreset } from '@rover/simulation';
import { RoverRuntime } from '../src';

function runtime(patch: (c: AppConfig) => void = () => {}, scenarioId = 'SINGLE_OBSTACLE') {
  const cfg = createDefaultConfig();
  patch(cfg);
  const rt = new RoverRuntime({ config: cfg, scenario: getPreset(scenarioId)! });
  rt.setMode('AUTO');
  return rt;
}

describe('Simulation → StateAggregator → MockDecisionEngine → SafetyController → LocalPlanner → Motor', () => {
  it('closes the loop: decisions produce /cmd_vel and the rover moves', async () => {
    const rt = runtime();
    const cmds: Twist[] = [];
    rt.transport.subscribe<Twist>(TOPICS.cmdVel, (m) => cmds.push(m.data));
    await rt.runFor(5);
    const ins = rt.autonomy.getInspector();
    expect(ins.history.length).toBeGreaterThanOrEqual(9);
    expect(rt.autonomy.lastState?.robot.x).toBeGreaterThan(4);
    expect(cmds.some((c) => c.linear.x > 0.5)).toBe(true);
    expect(rt.sim.rover.x).toBeGreaterThan(6);
    // AI decides at its own rate, not at the simulation rate.
    expect(rt.transport.getTopicInfo().find((t) => t.name === '/decision')!.messageCount).toBeLessThan(15);
    expect(rt.transport.getTopicInfo().find((t) => t.name === '/imu')!.messageCount).toBe(250);
  });

  it('reaches the target in SINGLE_OBSTACLE without collisions', async () => {
    const rt = runtime();
    rt.sim.mission.start();
    for (let i = 0; i < 120 && rt.sim.mission.state === 'RUNNING'; i++) await rt.runFor(1, { startMission: false });
    expect(rt.sim.mission.state).toBe('COMPLETED');
    expect(rt.sim.rover.collisions).toBe(0);
  });

  it('safety overrides an AI that insists on FORWARD into a wall', async () => {
    const cfg = createDefaultConfig();
    const rt = new RoverRuntime({
      config: cfg,
      scenario: { ...getPreset('EMPTY_FIELD')!, rover: { x: 5, y: 15, heading: 0 }, obstacles: [{ id: 'w', kind: 'rect', x: 10, y: 15, w: 1, h: 10 }], target: { x: 30, y: 15 } },
      engineFactory: () => ({
        id: 'always-forward',
        deterministic: true,
        decide: async () => ({ decision: { action: 'FORWARD', confidence: 1, reason: 'yolo', timestamp: 0 }, latencyMs: 0 }),
        healthCheck: async () => ({ ok: true, latencyMs: 0, message: '' }),
        getModelInfo: () => ({ provider: 'test', model: 'forward' }),
      }),
    });
    rt.setMode('AUTO');
    const verdicts = new Set<string>();
    rt.onTick = () => rt.autonomy.lastVerdict && verdicts.add(rt.autonomy.lastVerdict.action);
    await rt.runFor(15);
    expect(rt.sim.rover.collisions).toBe(0);
    expect(rt.sim.rover.x).toBeLessThan(9.5 - 0.3);
    expect(verdicts.has('EMERGENCY_STOP')).toBe(true);
  });

  it('AI timeout → AI_TIMEOUT and the safety layer stops the rover, simulation keeps running', async () => {
    const rt = runtime((c) => (c.failures.aiTimeout = true));
    await rt.runFor(4);
    expect(rt.autonomy.lastVerdict?.rule).toBe('AI_TIMEOUT');
    expect(rt.autonomy.lastCmd).toEqual({ linear: 0, angular: 0 });
    expect(rt.simTime).toBeCloseTo(4, 5);
    expect(rt.logger.recent(1000).some((e) => e.type === 'AI_TIMEOUT')).toBe(true);
  });

  it('invalid AI responses are blocked', async () => {
    const rt = runtime((c) => (c.failures.aiInvalidResponse = true));
    await rt.runFor(2);
    expect(rt.autonomy.lastVerdict?.rule).toBe('INVALID_AI_RESPONSE');
    expect(rt.sim.rover.linear).toBe(0);
  });

  it('injected AI latency is applied in simulation time', async () => {
    const rt = runtime((c) => (c.failures.aiLatencyMs = 250));
    await rt.runFor(3);
    const ins = rt.autonomy.getInspector();
    expect(ins.lastExchange?.latencyMs).toBeGreaterThanOrEqual(250);
    expect(ins.lastExchange?.injectedLatencyMs).toBe(250);
  });

  it('falls back to STOP when the Jev endpoint is offline, without crashing', async () => {
    const rt = runtime((c) => {
      c.ai.provider = 'local-jev';
      c.ai.jev.baseUrl = 'http://127.0.0.1:1';
      c.ai.timeoutMs = 200;
      c.ai.syncMode = 'lockstep';
    });
    await rt.runFor(2);
    expect(['AI_TIMEOUT', 'NO_DECISION']).toContain(rt.autonomy.lastVerdict?.rule);
    expect(rt.autonomy.linkStatus).toBe('OFFLINE');
    expect(rt.sim.rover.linear).toBe(0);
  });
});

describe('Deterministic simulation', () => {
  const signature = (rt: RoverRuntime) => ({
    x: rt.sim.rover.x,
    y: rt.sim.rover.y,
    h: rt.sim.rover.heading,
    battery: rt.sim.rover.battery.energyWh,
    scan: rt.transport.getLastMessage<{ ranges: number[] }>('/scan')?.data.ranges.slice(0, 20),
    decisions: rt.autonomy.getExchanges().map((e) => e.decision?.action),
  });

  it('same seed → identical run', async () => {
    const a = runtime((c) => (c.simulation.seed = 12345), 'MULTIPLE_OBSTACLES');
    const b = runtime((c) => (c.simulation.seed = 12345), 'MULTIPLE_OBSTACLES');
    await a.runFor(20);
    await b.runFor(20);
    expect(signature(a)).toEqual(signature(b));
  });

  it('different seed → different sensor noise', async () => {
    const a = runtime((c) => (c.simulation.seed = 1), 'MULTIPLE_OBSTACLES');
    const b = runtime((c) => (c.simulation.seed = 2), 'MULTIPLE_OBSTACLES');
    await a.runFor(5);
    await b.runFor(5);
    expect(signature(a).scan).not.toEqual(signature(b).scan);
  });

  it('reset reproduces the run', async () => {
    const rt = runtime((c) => (c.simulation.seed = 99));
    await rt.runFor(10);
    const first = signature(rt);
    await rt.reset();
    rt.setMode('AUTO');
    await rt.runFor(10);
    expect(signature(rt)).toEqual(first);
  });
});

describe('Recording', () => {
  it('records frames at the record rate with events and AI exchanges', async () => {
    const rt = runtime();
    await rt.runFor(5);
    const snap = rt.recorder.snapshot('mock');
    expect(snap.frames.length).toBeGreaterThanOrEqual(49);
    expect(snap.frames.length).toBeLessThanOrEqual(51);
    expect(snap.exchanges.length).toBeGreaterThan(5);
    expect(snap.events.some((e) => e.type === 'DECISION')).toBe(true);
    expect(snap.summary.distanceTravelled).toBeGreaterThan(1);
  });
});
