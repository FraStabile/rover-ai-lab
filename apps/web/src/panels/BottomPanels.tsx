import { useEffect, useMemo, useRef, useState } from 'react';
import type { LogCategory, LogEvent } from '@rover/protocol';
import { Badge, Btn, JsonView, KV, Section, TextField, cx, useAction } from '../components/ui';
import { api, type RunListItem } from '../lib/api';
import { fmt, fmtDuration, prettyJson } from '../lib/format';
import { useStore } from '../store';

// ------------------------------------------------------------------- LOGS

const FILTERS: Array<'ALL' | LogCategory> = ['ALL', 'SENSOR', 'AI', 'ROS2', 'SAFETY', 'MOTOR', 'MISSION', 'SYSTEM', 'ERROR'];

const CAT_COLOR: Record<LogCategory, string> = {
  SENSOR: 'text-sky-400',
  AI: 'text-violet',
  ROS2: 'text-accent',
  SAFETY: 'text-warn',
  MOTOR: 'text-emerald-400',
  MISSION: 'text-ok',
  SYSTEM: 'text-dim',
  ERROR: 'text-bad',
};

export function LogsPanel() {
  const liveLogs = useStore((s) => s.logs);
  const replay = useStore((s) => s.replay);
  const set = useStore((s) => s.set);
  const [filter, setFilter] = useState<'ALL' | LogCategory>('ALL');
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  const source: LogEvent[] = useMemo(() => {
    if (!replay) return liveLogs;
    const t = replay.run.frames[replay.index]?.simTime ?? 0;
    return replay.run.events.filter((e) => e.simulationTime <= t + 1e-6);
  }, [liveLogs, replay]);

  const rows = useMemo(() => {
    const q = query.toLowerCase();
    const out = source.filter(
      (e) =>
        (filter === 'ALL' || e.category === filter || (filter === 'ERROR' && e.level === 'error')) &&
        (!q || e.message.toLowerCase().includes(q) || e.source.toLowerCase().includes(q) || e.type.toLowerCase().includes(q)),
    );
    return out.slice(-800);
  }, [source, filter, query]);

  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [rows, follow]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1">
        {FILTERS.map((f) => (
          <Btn key={f} variant="ghost" active={filter === f} onClick={() => setFilter(f)} className="h-5 px-1.5 text-[10px]">
            {f}
          </Btn>
        ))}
        <div className="ml-2">
          <TextField value={query} onCommit={setQuery} placeholder="filter text…" width="w-40" />
        </div>
        <span className="ml-auto font-mono text-[10px] text-mute">{rows.length} lines{replay ? ' · replay' : ''}</span>
        <Btn variant="ghost" active={follow} onClick={() => setFollow(!follow)}>FOLLOW</Btn>
        {!replay && <Btn variant="ghost" onClick={() => set({ logs: [] })}>CLEAR</Btn>}
      </div>
      <div
        ref={ref}
        className="min-h-0 flex-1 overflow-auto px-2 py-1 font-mono text-[11px] leading-[1.5]"
        onWheel={(e) => e.deltaY < 0 && setFollow(false)}
      >
        {rows.map((e) => (
          <div key={e.id} className={cx('flex gap-2 whitespace-nowrap', e.level === 'error' ? 'text-bad' : e.level === 'warn' ? 'text-warn' : 'text-fg')}>
            <span className="text-mute">[{e.simulationTime.toFixed(3)}s]</span>
            <span className={cx('w-14 shrink-0', CAT_COLOR[e.category])}>{e.category}</span>
            <span className="w-32 shrink-0 truncate text-dim">{e.source}</span>
            <span className="truncate">{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- AI INSPECTOR

export function AiInspectorPanel() {
  const ai = useStore((s) => s.ai);
  const replay = useStore((s) => s.replay);
  if (replay) return <ReplayInspector />;
  if (!ai) return <div className="p-3 text-dim">No AI data yet.</div>;
  const ex = ai.lastExchange;
  const d = ex?.decision;
  return (
    <div className="grid h-full min-h-0 grid-cols-[260px_1fr_1fr_1fr_280px]">
      <div className="overflow-auto border-r border-line">
        <Section title="Engine">
          <KV k="Provider" v={ai.provider} tone="violet" />
          <KV k="Model" v={ai.model?.model ?? '—'} />
          <KV k="Endpoint" v={<span className="text-[10px]">{ai.model?.endpoint ?? 'in-process'}</span>} />
          <KV k="Link" v={ai.status} tone={ai.status === 'CONNECTED' || ai.status === 'MOCK' ? 'ok' : ai.status === 'TIMEOUT' ? 'warn' : 'bad'} />
          <KV k="Decision rate" v={`${ai.decisionsPerSecond.toFixed(2)} Hz`} />
          <KV k="Avg latency" v={fmt(ai.avgLatencyMs, 0, ' ms')} />
        </Section>
        <Section title="Last decision">
          <div className={cx('font-mono text-[18px] font-bold', d ? 'text-violet' : 'text-bad')}>{d?.action ?? ex?.error?.code ?? '—'}</div>
          <KV k="Confidence" v={d ? `${Math.round(d.confidence * 100)}%` : '—'} />
          <KV k="Latency" v={ex ? `${ex.latencyMs} ms` : '—'} />
          {ex && ex.injectedLatencyMs > 0 && <KV k="Injected latency" v={`${ex.injectedLatencyMs} ms`} tone="warn" />}
          <KV k="Request #" v={ex?.id ?? '—'} />
          <KV k="Sim time" v={ex ? `${ex.simTime.toFixed(3)} s` : '—'} />
          <KV k="Timestamp" v={ex ? new Date(ex.timestamp).toLocaleTimeString() : '—'} />
          {d?.reason && <div className="pt-1 text-[11px] text-dim">“{d.reason}”</div>}
          {ex?.error && <div className="pt-1 text-[11px] text-bad">{ex.error.message}</div>}
        </Section>
      </div>
      <Pane title="Current state → AI (JSON)">{prettyJson(ex?.state ?? null)}</Pane>
      <Pane title="Last request">{prettyJson(ex?.request ?? null)}</Pane>
      <Pane title="Last response">{prettyJson(ex?.response ?? null)}</Pane>
      <div className="flex min-h-0 flex-col border-l border-line">
        <div className="label border-b border-line px-2 py-1">Decision history</div>
        <div className="min-h-0 flex-1 overflow-auto font-mono text-[10px]">
          {ai.history.map((h) => (
            <div key={h.id} className="flex gap-2 border-b border-line/40 px-2 py-px">
              <span className="w-10 text-mute">#{h.id}</span>
              <span className="w-14 text-dim">{h.simTime.toFixed(2)}s</span>
              <span className={cx('flex-1', h.decision ? 'text-violet' : 'text-bad')}>{h.decision?.action ?? h.error?.code}</span>
              <span className="w-9 text-right">{h.decision ? `${Math.round(h.decision.confidence * 100)}%` : ''}</span>
              <span className="w-12 text-right text-dim">{h.latencyMs}ms</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReplayInspector() {
  const replay = useStore((s) => s.replay)!;
  const t = replay.run.frames[replay.index]?.simTime ?? 0;
  const past = replay.run.exchanges.filter((x) => x.simTime <= t);
  const last = past[past.length - 1];
  return (
    <div className="grid h-full min-h-0 grid-cols-[1fr_1fr_1fr_280px]">
      <Pane title={`State sent at ${last?.simTime.toFixed(2) ?? '—'}s`}>{prettyJson(last?.state ?? null)}</Pane>
      <Pane title="Request">{prettyJson(last?.request ?? null)}</Pane>
      <Pane title="Response">{prettyJson(last?.response ?? null)}</Pane>
      <div className="min-h-0 overflow-auto border-l border-line font-mono text-[10px]">
        {past
          .slice(-100)
          .reverse()
          .map((h) => (
            <div key={h.id} className="flex gap-2 border-b border-line/40 px-2 py-px">
              <span className="w-10 text-mute">#{h.id}</span>
              <span className="w-14 text-dim">{h.simTime.toFixed(2)}s</span>
              <span className={cx('flex-1', h.decision ? 'text-violet' : 'text-bad')}>{h.decision?.action ?? h.error?.code}</span>
              <span className="w-12 text-right text-dim">{h.latencyMs ?? 0}ms</span>
            </div>
          ))}
      </div>
    </div>
  );
}

function Pane({ title, children }: { title: string; children: string }) {
  return (
    <div className="flex min-h-0 flex-col border-r border-line">
      <div className="label border-b border-line px-2 py-1">{title}</div>
      <div className="min-h-0 flex-1 overflow-hidden p-1">
        <JsonView value={children} className="h-full" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- STATE

export function StatePanel() {
  const state = useStore((s) => s.aggState);
  const frame = useStore((s) => s.frame);
  return (
    <div className="grid h-full min-h-0 grid-cols-[1fr_1fr_1fr]">
      <Pane title="StateAggregator output (/rover_state)">{prettyJson(state)}</Pane>
      <Pane title="SafetyController verdict (/safety)">{prettyJson(frame?.safety ?? null)}</Pane>
      <Pane title="/cmd_vel + current decision">{prettyJson({ cmd_vel: frame?.cmdVel ?? null, decision: frame?.decision ?? null, mode: frame?.mode, estop: frame?.estop })}</Pane>
    </div>
  );
}

// ------------------------------------------------------------------- DEBUG

export function DebugPanel() {
  const d = useStore((s) => s.debug);
  const fps = useStore((s) => s.renderFps);
  const frame = useStore((s) => s.frame);
  if (!d) return <div className="p-3 text-dim">Waiting for debug stats…</div>;
  return (
    <div className="grid h-full grid-cols-4 gap-0 overflow-auto">
      <Section title="Simulation">
        <KV k="Tick" v={d.ticks} />
        <KV k="Sim tick rate" v={`${d.simTickRate.toFixed(1)} Hz`} />
        <KV k="Realtime factor" v={`×${d.realtimeFactor.toFixed(2)}`} />
        <KV k="Step duration" v={`${d.stepDurationMs.toFixed(3)} ms`} />
        <KV k="Loop lag" v={`${d.loopLagMs.toFixed(1)} ms`} />
        <KV k="Sim time" v={`${d.simTime.toFixed(2)} s`} />
      </Section>
      <Section title="Topic rates (sim time)">
        {Object.entries(d.sensorTickRates).map(([k, v]) => (
          <KV key={k} k={k} v={`${v.toFixed(1)} Hz`} />
        ))}
      </Section>
      <Section title="AI & transport">
        <KV k="AI decision rate" v={`${d.aiTickRate.toFixed(2)} Hz`} />
        <KV k="AI latency" v={fmt(frame?.ai.latencyMs, 0, ' ms')} />
        <KV k="WebSocket rate" v={`${d.wsMessageRate.toFixed(0)} msg/s`} />
        <KV k="WS clients" v={d.wsClients} />
      </Section>
      <Section title="Host">
        <KV k="Render FPS" v={fps} />
        <KV k="Server memory (RSS)" v={fmt(d.memoryMb, 1, ' MB')} />
        <KV k="CPU" v={d.cpuPercent === null ? 'n/a' : `${d.cpuPercent}%`} />
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------- RUNS / REPLAY

export function RunsPanel() {
  const recording = useStore((s) => s.recording);
  const frame = useStore((s) => s.frame);
  const replay = useStore((s) => s.replay);
  const set = useStore((s) => s.set);
  const act = useAction();
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [name, setName] = useState('');

  const refresh = async () => setRuns((await act(() => api.listRuns())) ?? []);
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadReplay = async (id: string) => {
    const run = await act(() => api.getRun(id));
    if (!run) return;
    if (run.frames.length === 0) return useStore.getState().toast('Run has no frames', 'error');
    if (useStore.getState().status === 'RUNNING') await api.control('pause');
    set({ replay: { run, index: 0, playing: false, speed: 1 }, tool: 'none', draft: null });
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="w-72 shrink-0 border-r border-line">
        <Section title="Current recording">
          <KV k="Recorded" v={`${recording.frames} frames · ${fmtDuration(recording.duration)}`} />
          <KV k="Sim time" v={`${(frame?.simTime ?? 0).toFixed(1)} s`} />
          <div className="flex gap-1 pt-1">
            <TextField value={name} mono={false} width="w-full" placeholder="run name (optional)" onCommit={setName} />
            <Btn
              variant="primary"
              onClick={() =>
                act(async () => {
                  await api.saveRun(name || undefined);
                  setName('');
                  await refresh();
                }, 'Run saved')
              }
            >
              SAVE RUN
            </Btn>
          </div>
          <div className="text-[10px] text-mute">Recording restarts on every reset / scenario load. Stored: scenario, parameters, telemetry frames, sensor scans, AI requests & responses, decisions, commands and events.</div>
        </Section>
        {replay && (
          <Section title="Replay">
            <KV k="Run" v={replay.run.name} />
            <Btn variant="warn" className="w-full" onClick={() => set({ replay: null })}>
              EXIT REPLAY
            </Btn>
          </Section>
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-auto">
        <table className="w-full font-mono text-[11px]">
          <thead className="sticky top-0 bg-panel text-left text-[10px] uppercase tracking-wider text-dim">
            <tr className="border-b border-line">
              <th className="px-2 py-1 font-medium">Name</th>
              <th className="px-2 py-1 font-medium">Scenario</th>
              <th className="px-2 py-1 font-medium">AI</th>
              <th className="px-2 py-1 font-medium">Seed</th>
              <th className="px-2 py-1 text-right font-medium">Duration</th>
              <th className="px-2 py-1 text-right font-medium">Distance</th>
              <th className="px-2 py-1 text-right font-medium">Decisions</th>
              <th className="px-2 py-1 text-right font-medium">Coll.</th>
              <th className="px-2 py-1 font-medium">Mission</th>
              <th className="px-2 py-1 font-medium" />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className={cx('border-b border-line/50 hover:bg-panel2', replay?.run.id === r.id && 'bg-accent/10')}>
                <td className="max-w-64 truncate px-2 py-0.5 font-sans">{r.name}</td>
                <td className="px-2 py-0.5 text-dim">{r.scenarioName}</td>
                <td className="px-2 py-0.5 text-violet">{r.provider}</td>
                <td className="px-2 py-0.5 text-dim">{r.seed}</td>
                <td className="px-2 py-0.5 text-right">{fmtDuration(r.duration)}</td>
                <td className="px-2 py-0.5 text-right">{r.summary.distanceTravelled.toFixed(1)} m</td>
                <td className="px-2 py-0.5 text-right">{r.summary.decisions}</td>
                <td className={cx('px-2 py-0.5 text-right', r.summary.collisions > 0 && 'text-bad')}>{r.summary.collisions}</td>
                <td className="px-2 py-0.5">
                  <Badge tone={r.summary.missionState === 'COMPLETED' ? 'ok' : r.summary.missionState === 'FAILED' ? 'bad' : 'dim'}>{r.summary.missionState}</Badge>
                </td>
                <td className="whitespace-nowrap px-2 py-0.5 text-right">
                  <Btn variant="primary" onClick={() => loadReplay(r.id)}>REPLAY</Btn>{' '}
                  <Btn title="Load this run's scenario and parameters into the simulator" onClick={() => act(() => api.restoreRun(r.id), 'Scenario & parameters restored')}>RESTORE</Btn>{' '}
                  <Btn variant="ghost" onClick={() => act(async () => { await api.deleteRun(r.id); if (replay?.run.id === r.id) set({ replay: null }); await refresh(); })}>✕</Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {runs.length === 0 && <div className="p-3 text-dim">No saved runs. Run a simulation, then press SAVE RUN.</div>}
      </div>
    </div>
  );
}
