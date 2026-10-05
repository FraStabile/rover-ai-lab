import { useCallback, useEffect, useState } from 'react';
import type { MissionDefinition, Scenario } from '@rover/protocol';
import { Badge, Btn, Field, NumField, Section, Select, TextField, Toggle, cx, useAction } from '../components/ui';
import { api } from '../lib/api';
import { useStore } from '../store';

export function ScenarioPanel() {
  const scenario = useStore((s) => s.scenario);
  const selected = useStore((s) => s.selectedObstacle);
  const replay = useStore((s) => s.replay);
  const set = useStore((s) => s.set);
  const act = useAction();
  const [presets, setPresets] = useState<Scenario[]>([]);
  const [saved, setSaved] = useState<Scenario[]>([]);
  const [gen, setGen] = useState({ numberOfObstacles: 15, minimumDistance: 1.5, maximumDistance: 30, difficulty: 'medium' as 'easy' | 'medium' | 'hard', seed: 12345 });

  const refresh = useCallback(async () => {
    const r = await act(() => api.listScenarios());
    if (r) {
      setPresets(r.presets);
      setSaved(r.saved);
    }
  }, [act]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!scenario) return null;
  const disabled = !!replay;

  const edit = (fn: (s: Scenario) => void) => {
    const next = structuredClone(scenario);
    fn(next);
    void act(async () => {
      const s = await api.loadScenario({ ...next, builtIn: false });
      set({ scenario: s });
    });
  };
  const load = (s: Scenario) =>
    act(async () => {
      const r = await api.loadScenario(s);
      set({ scenario: r, selectedObstacle: null, draft: null });
    }, `Loaded "${s.name}"`);

  const sel = scenario.obstacles.find((o) => o.id === selected);
  const mission = scenario.mission;
  const setMission = (patch: Partial<MissionDefinition>) => edit((s) => (s.mission = { ...s.mission, ...patch }));

  return (
    <div className={cx(disabled && 'pointer-events-none opacity-50')}>
      <Section title="Preset scenarios">
        <div className="grid grid-cols-2 gap-1">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.description}
              onClick={() => load(p)}
              className={cx(
                'truncate rounded-sm border px-1.5 py-1 text-left font-mono text-[10px]',
                scenario.id === p.id ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 bg-panel2 text-fg hover:border-accent/40',
              )}
            >
              {p.id}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Saved scenarios" right={<Btn variant="ghost" onClick={refresh}>↻</Btn>}>
        {saved.length === 0 && <div className="text-[11px] text-mute">No saved scenarios yet.</div>}
        {saved.map((s) => (
          <div key={s.id} className="flex items-center gap-1">
            <button type="button" onClick={() => load(s)} className={cx('flex-1 truncate text-left text-[11px] hover:text-accent', scenario.id === s.id && 'text-accent')}>
              {s.name}
            </button>
            <Btn variant="ghost" onClick={() => act(async () => { await api.deleteScenario(s.id); await refresh(); })}>✕</Btn>
          </div>
        ))}
      </Section>

      <Section
        title="Current scenario"
        right={
          <Btn
            variant="primary"
            onClick={() =>
              act(async () => {
                const s = await api.saveScenario(scenario);
                await api.loadScenario(s);
                set({ scenario: s });
                await refresh();
              }, 'Scenario saved')
            }
          >
            SAVE
          </Btn>
        }
      >
        <Field label="Name">
          <TextField value={scenario.name} mono={false} onCommit={(v) => edit((s) => (s.name = v || 'Untitled'))} />
        </Field>
        <Field label="World W × H (m)">
          <NumField value={scenario.world.width} step={1} min={5} max={500} width="w-14" onCommit={(v) => edit((s) => (s.world.width = v))} />
          <NumField value={scenario.world.height} step={1} min={5} max={500} width="w-14" onCommit={(v) => edit((s) => (s.world.height = v))} />
        </Field>
        <Field label="Rover X, Y (m)">
          <NumField value={scenario.rover.x} width="w-14" onCommit={(v) => edit((s) => (s.rover.x = v))} />
          <NumField value={scenario.rover.y} width="w-14" onCommit={(v) => edit((s) => (s.rover.y = v))} />
        </Field>
        <Field label="Rover heading (°)">
          <NumField value={scenario.rover.heading} step={5} min={-360} max={360} width="w-14" onCommit={(v) => edit((s) => (s.rover.heading = v))} />
        </Field>
        <Field label="Target X, Y (m)">
          {scenario.target ? (
            <>
              <NumField value={scenario.target.x} width="w-14" onCommit={(v) => edit((s) => (s.target = { x: v, y: s.target?.y ?? 0 }))} />
              <NumField value={scenario.target.y} width="w-14" onCommit={(v) => edit((s) => (s.target = { x: s.target?.x ?? 0, y: v }))} />
              <Btn variant="ghost" onClick={() => edit((s) => (s.target = null))}>✕</Btn>
            </>
          ) : (
            <Btn onClick={() => edit((s) => (s.target = { x: s.world.width - 4, y: s.world.height / 2 }))}>+ add</Btn>
          )}
        </Field>
        <div className="text-[10px] text-dim">
          {scenario.obstacles.length} obstacles · {scenario.waypoints.length} waypoints · use the map toolbar to draw
        </div>
        {scenario.waypoints.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {scenario.waypoints.map((w, i) => (
              <Badge key={i} tone="violet" className="gap-1">
                {i + 1}: {w.x.toFixed(1)},{w.y.toFixed(1)}
                <button type="button" className="pointer-events-auto hover:text-white" onClick={() => edit((s) => s.waypoints.splice(i, 1))}>
                  ✕
                </button>
              </Badge>
            ))}
            <Btn variant="ghost" onClick={() => edit((s) => (s.waypoints = []))}>clear</Btn>
          </div>
        )}
      </Section>

      {sel && (
        <Section title={`Obstacle ${sel.id}`} right={<Btn variant="danger" onClick={() => { edit((s) => (s.obstacles = s.obstacles.filter((o) => o.id !== sel.id))); set({ selectedObstacle: null }); }}>DELETE</Btn>}>
          <Field label="Centre X, Y">
            <NumField value={sel.x} width="w-14" onCommit={(v) => edit((s) => { const o = s.obstacles.find((x) => x.id === sel.id); if (o) o.x = v; })} />
            <NumField value={sel.y} width="w-14" onCommit={(v) => edit((s) => { const o = s.obstacles.find((x) => x.id === sel.id); if (o) o.y = v; })} />
          </Field>
          {sel.kind === 'rect' ? (
            <Field label="W × H">
              <NumField value={sel.w} min={0.1} width="w-14" onCommit={(v) => edit((s) => { const o = s.obstacles.find((x) => x.id === sel.id); if (o?.kind === 'rect') o.w = v; })} />
              <NumField value={sel.h} min={0.1} width="w-14" onCommit={(v) => edit((s) => { const o = s.obstacles.find((x) => x.id === sel.id); if (o?.kind === 'rect') o.h = v; })} />
            </Field>
          ) : (
            <Field label="Radius">
              <NumField value={sel.r} min={0.1} width="w-14" onCommit={(v) => edit((s) => { const o = s.obstacles.find((x) => x.id === sel.id); if (o?.kind === 'circle') o.r = v; })} />
            </Field>
          )}
        </Section>
      )}

      <Section title="Mission">
        <Field label="Objective">
          <Select<MissionDefinition['objective']>
            value={mission.objective}
            width="w-36"
            options={[
              { value: 'REACH_TARGET', label: 'Reach target' },
              { value: 'FOLLOW_WAYPOINTS', label: 'Follow waypoints' },
              { value: 'FREE_ROAM', label: 'Free roam' },
            ]}
            onChange={(v) => setMission({ objective: v })}
          />
        </Field>
        <Field label="Goal tolerance">
          <NumField value={mission.tolerance} min={0.1} max={10} unit="m" onCommit={(v) => setMission({ tolerance: v })} />
        </Field>
        <Field label="Time limit (0 = ∞)">
          <NumField value={mission.maxDuration} step={10} min={0} unit="s" onCommit={(v) => setMission({ maxDuration: v })} />
        </Field>
        <Field label="Fail on collision">
          <Toggle checked={mission.failOnCollision} onChange={(v) => setMission({ failOnCollision: v })} />
        </Field>
      </Section>

      <Section title="Random scenario generator">
        <Field label="Obstacles">
          <NumField value={gen.numberOfObstacles} step={1} min={0} max={200} onCommit={(v) => setGen({ ...gen, numberOfObstacles: v })} />
        </Field>
        <Field label="Minimum distance">
          <NumField value={gen.minimumDistance} min={0} max={20} unit="m" onCommit={(v) => setGen({ ...gen, minimumDistance: v })} />
        </Field>
        <Field label="Max start→target">
          <NumField value={gen.maximumDistance} step={1} min={5} max={200} unit="m" onCommit={(v) => setGen({ ...gen, maximumDistance: v })} />
        </Field>
        <Field label="Difficulty">
          <Select value={gen.difficulty} options={['easy', 'medium', 'hard'] as const} onChange={(v) => setGen({ ...gen, difficulty: v })} />
        </Field>
        <Field label="Seed">
          <NumField value={gen.seed} step={1} min={0} onCommit={(v) => setGen({ ...gen, seed: v })} />
          <Btn variant="ghost" title="Random seed" onClick={() => setGen({ ...gen, seed: Math.floor(Math.random() * 1e6) })}>🎲</Btn>
        </Field>
        <Btn
          variant="primary"
          className="w-full"
          onClick={() =>
            act(async () => {
              const r = await api.generateScenario({ ...gen, load: true });
              set({ scenario: r.scenario, selectedObstacle: null, draft: null });
            }, `Generated scenario (seed ${gen.seed})`)
          }
        >
          GENERATE RANDOM SCENARIO
        </Btn>
      </Section>
    </div>
  );
}
