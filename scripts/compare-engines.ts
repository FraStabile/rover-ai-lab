/**
 * Headless A/B benchmark: runs the same scenarios with the same seed for several
 * decision engines / parameter sets and prints a comparison table.
 *
 *   npm run compare                          # mock on all presets
 *   npm run compare -- --jev http://localhost:8000 --scenarios SINGLE_OBSTACLE,MAZE --seed 7
 */
import { createDefaultConfig, type AiProvider } from '@rover/protocol';
import { RoverRuntime } from '@rover/runtime';
import { PRESET_SCENARIOS } from '@rover/simulation';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const seed = Number(opt('seed') ?? 12345);
const ids = opt('scenarios')?.split(',');
const jevUrl = opt('jev');
const providers: AiProvider[] = jevUrl ? ['mock', 'local-jev'] : ['mock'];

const rows: string[][] = [['scenario', 'engine', 'result', 'time s', 'dist m', 'collisions', 'decisions', 'overrides', 'battery %']];
for (const scenario of PRESET_SCENARIOS.filter((s) => !ids || ids.includes(s.id))) {
  for (const provider of providers) {
    const cfg = createDefaultConfig();
    cfg.simulation.seed = seed;
    cfg.ai.provider = provider;
    if (provider === 'local-jev') {
      cfg.ai.jev.baseUrl = jevUrl!;
      cfg.ai.syncMode = 'lockstep';
    }
    const rt = new RoverRuntime({ config: cfg, scenario });
    rt.setMode('AUTO');
    let overrides = 0;
    rt.logger.subscribe((e) => e.type === 'SAFETY_OVERRIDE' && overrides++);
    rt.sim.mission.start();
    const limit = scenario.mission.maxDuration || 180;
    while (rt.simTime < limit && rt.sim.mission.state === 'RUNNING') await rt.runFor(1, { startMission: false });
    const snap = rt.recorder.snapshot(provider);
    rows.push([
      scenario.id,
      provider,
      rt.sim.mission.state,
      rt.simTime.toFixed(1),
      snap.summary.distanceTravelled.toFixed(1),
      String(rt.sim.rover.collisions),
      String(snap.summary.decisions),
      String(overrides),
      rt.sim.rover.battery.percentage.toFixed(1),
    ]);
  }
}
const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i])).join('  '));
