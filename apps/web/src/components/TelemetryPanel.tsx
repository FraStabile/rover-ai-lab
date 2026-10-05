import { useEffect, useMemo, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SimFrame } from '@rover/protocol';
import { api } from '../lib/api';
import { fmt, fmtDuration, paddedDomain } from '../lib/format';
import { live, sampleFromFrame, type TelemetrySample } from '../lib/live';
import { useStore } from '../store';
import { Badge, Btn, KV, Section, cx, useAction, type Tone } from './ui';

/** Samples telemetry for charts a few times per second (never on every frame). */
export function useSamples(intervalMs = 250): TelemetrySample[] {
  const replay = useStore((s) => s.replay);
  const [samples, setSamples] = useState<TelemetrySample[]>([]);
  useEffect(() => {
    const tick = () => {
      const r = useStore.getState().replay;
      if (r) {
        const end = r.index + 1;
        const start = Math.max(0, end - 600);
        setSamples(r.run.frames.slice(start, end).map(sampleFromFrame));
      } else {
        setSamples(live.samples.slice(-300));
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, replay]);
  return samples;
}

const MISSION_TONE: Record<string, Tone> = { IDLE: 'dim', RUNNING: 'accent', PAUSED: 'warn', COMPLETED: 'ok', FAILED: 'bad', ABORTED: 'bad' };

export function TelemetryPanel() {
  const liveFrame = useStore((s) => s.frame);
  const replay = useStore((s) => s.replay);
  const f: SimFrame | null = replay ? (replay.run.frames[replay.index] ?? null) : liveFrame;
  const samples = useSamples();
  const act = useAction();

  if (!f) return <div className="p-4 text-dim">Waiting for telemetry…</div>;
  const m = f.mission;
  const b = f.battery;
  const d = f.decision;
  const sv = f.safety;

  return (
    <div className="h-full overflow-y-auto">
      <Section
        title="Mission"
        right={<Badge tone={MISSION_TONE[m.state] ?? 'dim'}>{m.state}</Badge>}
      >
        <KV k="Goal" v={m.goal ? `${m.goal.x.toFixed(1)}, ${m.goal.y.toFixed(1)}  (${Math.min(m.goalIndex + 1, m.goalCount)}/${m.goalCount})` : '—'} />
        <KV k="Distance to target" v={fmt(m.distance, 2, ' m')} tone="accent" />
        <KV k="Bearing" v={m.bearing === null ? '—' : `${m.bearing.toFixed(1)}°`} />
        <KV k="ETA" v={fmtDuration(m.eta)} />
        <KV k="Elapsed" v={fmtDuration(m.elapsed)} />
        <KV k="Collisions" v={f.collisions} tone={f.collisions > 0 ? 'bad' : undefined} />
        {!replay && (
          <div className="flex gap-1 pt-1">
            <Btn onClick={() => act(() => api.mission('start'))} className="flex-1">START</Btn>
            <Btn onClick={() => act(() => api.mission('pause'))} className="flex-1">PAUSE</Btn>
            <Btn variant="danger" onClick={() => act(() => api.mission('abort'))} className="flex-1">ABORT</Btn>
          </div>
        )}
      </Section>

      <Section title="AI decision → safety → /cmd_vel" right={<Badge tone="violet">{f.ai.provider}</Badge>}>
        <div className="flex items-center justify-between">
          <span className={cx('font-mono text-[15px] font-bold', d ? 'text-violet' : 'text-mute')}>{f.mode === 'MANUAL' ? 'MANUAL' : (d?.action ?? '—')}</span>
          <span className="num text-[11px] text-dim">{f.ai.latencyMs !== null ? `${f.ai.latencyMs} ms` : ''}{f.ai.inFlight ? ' · …' : ''}</span>
        </div>
        {d && f.mode === 'AUTO' && (
          <>
            <div className="h-1.5 overflow-hidden rounded-full bg-bg">
              <div className="h-full bg-violet" style={{ width: `${Math.round(d.confidence * 100)}%` }} />
            </div>
            <div className="flex justify-between text-[10px] text-dim">
              <span className="truncate pr-2">{d.reason}</span>
              <span className="num">{Math.round(d.confidence * 100)}%</span>
            </div>
          </>
        )}
        {sv && (
          <div className={cx('rounded-sm border px-2 py-1', sv.verdict === 'ALLOW' ? 'border-ok/30 bg-ok/5' : sv.verdict === 'OVERRIDE' ? 'border-warn/40 bg-warn/5' : 'border-bad/40 bg-bad/10')}>
            <div className="flex items-center justify-between font-mono text-[11px]">
              <span className={sv.verdict === 'ALLOW' ? 'text-ok' : sv.verdict === 'OVERRIDE' ? 'text-warn' : 'text-bad'}>{sv.verdict}</span>
              <span className="text-fg">{sv.verdict === 'ALLOW' ? (sv.requested ?? '—') : `${sv.requested ?? '—'} → ${sv.action}`}</span>
            </div>
            <div className="text-[10px] text-dim">
              {sv.rule !== 'NONE' && <span className="mr-1 font-mono text-warn">[{sv.rule}]</span>}
              {sv.reason}
            </div>
          </div>
        )}
        <KV k="/cmd_vel linear" v={`${f.cmdVel.linear.toFixed(2)} m/s`} />
        <KV k="/cmd_vel angular" v={`${f.cmdVel.angular.toFixed(2)} rad/s`} />
      </Section>

      <Section title="Battery" right={<Badge tone={b.health === 'GOOD' ? 'ok' : b.health === 'LOW' ? 'warn' : 'bad'}>{b.health}</Badge>}>
        <div className="flex items-center gap-2">
          <div className="h-2.5 flex-1 overflow-hidden rounded-sm border border-line2 bg-bg">
            <div className={cx('h-full', b.percentage > 30 ? 'bg-ok' : b.percentage > 15 ? 'bg-warn' : 'bg-bad')} style={{ width: `${Math.max(0, Math.min(100, b.percentage))}%` }} />
          </div>
          <span className="num w-14 text-right text-[13px] text-white">{b.percentage.toFixed(1)}%</span>
        </div>
        <KV k="Voltage" v={`${b.voltage.toFixed(2)} V`} />
        <KV k="Current" v={`${b.current.toFixed(2)} A`} />
        <KV k="Remaining" v={b.remainingTime < 0 ? '∞' : fmtDuration(b.remainingTime)} />
      </Section>

      <Section title="Motors">
        <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
          <span />
          <span className="text-center text-dim">LEFT</span>
          <span className="text-center text-dim">RIGHT</span>
          {(
            [
              ['rpm', (x: SimFrame['motors']['left']) => x.rpm.toFixed(0)],
              ['temp °C', (x: SimFrame['motors']['left']) => x.temperature.toFixed(1)],
              ['current A', (x: SimFrame['motors']['left']) => x.current.toFixed(2)],
              ['voltage V', (x: SimFrame['motors']['left']) => x.voltage.toFixed(1)],
            ] as const
          ).map(([k, g]) => (
            <Row3 key={k} k={k} l={g(f.motors.left)} r={g(f.motors.right)} />
          ))}
          <span className="text-dim">error</span>
          <span className={cx('text-center', f.motors.left.error !== 'NONE' ? 'text-bad' : 'text-ok')}>{f.motors.left.error}</span>
          <span className={cx('text-center', f.motors.right.error !== 'NONE' ? 'text-bad' : 'text-ok')}>{f.motors.right.error}</span>
        </div>
      </Section>

      <Section title="GPS" right={<Badge tone={f.gps?.fix ? 'ok' : 'bad'}>{f.gps?.fix ? 'FIX' : 'NO FIX'}</Badge>}>
        <KV k="Latitude" v={f.gps?.fix ? f.gps.latitude.toFixed(7) : '—'} />
        <KV k="Longitude" v={f.gps?.fix ? f.gps.longitude.toFixed(7) : '—'} />
        <KV k="Odom drift" v={`${Math.hypot(f.pose.x - f.odomPose.x, f.pose.y - f.odomPose.y).toFixed(2)} m`} />
      </Section>

      <Section title="Charts">
        <Chart title="Speed (m/s) · cmd" data={samples} lines={[{ key: 'speed', color: '#22d3ee' }, { key: 'cmdLinear', color: '#f5a524', dashed: true }]} />
        <Chart title="Acceleration (m/s²)" data={samples} lines={[{ key: 'accel', color: '#38bdf8' }]} />
        <Chart title="Angular velocity (rad/s)" data={samples} lines={[{ key: 'angular', color: '#a78bfa' }, { key: 'cmdAngular', color: '#f5a524', dashed: true }]} />
        <Chart title="Battery (%)" data={samples} lines={[{ key: 'battery', color: '#34d399' }]} />
        <Chart title="Motor RPM L/R" data={samples} lines={[{ key: 'rpmL', color: '#22d3ee' }, { key: 'rpmR', color: '#f472b6' }]} />
        <Chart title="Motor temperature (°C) L/R" data={samples} lines={[{ key: 'tempL', color: '#f5a524' }, { key: 'tempR', color: '#f43f5e' }]} />
        <Chart title="AI latency (ms)" data={samples} lines={[{ key: 'latency', color: '#a78bfa' }]} />
      </Section>
    </div>
  );
}

function Row3({ k, l, r }: { k: string; l: string; r: string }) {
  return (
    <>
      <span className="text-dim">{k}</span>
      <span className="text-center num">{l}</span>
      <span className="text-center num">{r}</span>
    </>
  );
}

export function Chart({
  title,
  data,
  lines,
  height = 70,
}: {
  title: string;
  data: object[];
  lines: Array<{ key: string; color: string; dashed?: boolean }>;
  height?: number;
}) {
  const last = data[data.length - 1] as Record<string, number | null> | undefined;
  const ticks = useMemo(() => {
    if (data.length < 2) return undefined;
    const a = (data[0] as { t: number }).t;
    const b = (data[data.length - 1] as { t: number }).t;
    // Recharts keys ticks by value: never pass duplicates.
    return b - a > 1e-6 ? [a, b] : undefined;
  }, [data]);
  const domain = useMemo(() => paddedDomain(data, lines.map((l) => l.key)), [data, lines]);
  const hasValues = data.some((d) => lines.some((l) => typeof (d as Record<string, unknown>)[l.key] === 'number'));
  return (
    <div>
      <div className="flex justify-between text-[10px] text-dim">
        <span>{title}</span>
        <span className="num" style={{ color: lines[0].color }}>
          {last && typeof last[lines[0].key] === 'number' ? (last[lines[0].key] as number).toFixed(2) : '—'}
        </span>
      </div>
      <div style={{ height }}>
        {data.length < 2 || !ticks || !hasValues ? (
          <div className="flex h-full items-center justify-center rounded-sm border border-dashed border-line text-[10px] text-mute">no data</div>
        ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: -28 }}>
            <XAxis dataKey="t" type="number" domain={ticks ?? [0, 1]} allowDataOverflow ticks={ticks} tickFormatter={(v: number) => `${v.toFixed(0)}s`} tick={{ fontSize: 9, fill: '#47546a' }} stroke="#1f2935" />
            <YAxis tick={{ fontSize: 9, fill: '#47546a' }} stroke="#1f2935" width={50} domain={domain} tickCount={3} allowDataOverflow tickFormatter={(v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1))} />
            <Tooltip
              contentStyle={{ background: '#0f141b', border: '1px solid #2a3646', fontSize: 10, fontFamily: 'ui-monospace' }}
              labelFormatter={(v) => `t=${Number(v).toFixed(2)}s`}
              formatter={(v) => (typeof v === 'number' ? v.toFixed(3) : String(v))}
            />
            {lines.map((l) => (
              <Line key={l.key} type="linear" dataKey={l.key} stroke={l.color} strokeWidth={1.3} dot={false} isAnimationActive={false} strokeDasharray={l.dashed ? '3 3' : undefined} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
