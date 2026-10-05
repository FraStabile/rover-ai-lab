import { useEffect, useMemo, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, JsonView, Select, cx } from '../components/ui';
import { ago, getPath, numericPaths, paddedDomain, prettyJson } from '../lib/format';
import { subscribeTopic } from '../lib/ws';
import { useStore } from '../store';

/** rqt-like topic monitor over the virtual ROS2 graph. */
export function TopicsPanel() {
  const topics = useStore((s) => s.topics);
  const selected = useStore((s) => s.selectedTopic);
  const messages = useStore((s) => s.topicMessages);
  const [, force] = useState(0);
  const [field, setField] = useState<string>('');

  // Re-render "last update" ages.
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 500);
    return () => clearInterval(id);
  }, []);

  const last = messages[messages.length - 1];
  const paths = useMemo(() => (last ? numericPaths(last.data) : []), [last]);
  const plotField = paths.includes(field) ? field : (paths.find((p) => /linear\.x|percentage|angular_velocity\.z|rpm|confidence|elapsed/.test(p)) ?? paths[0] ?? '');
  const plotData = useMemo(
    () => messages.map((m) => ({ t: m.simTime, v: plotField ? (getPath(m.data, plotField) as number) : null })).filter((d) => typeof d.v === 'number'),
    [messages, plotField],
  );
  const selInfo = topics.find((t) => t.name === selected);

  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead className="sticky top-0 bg-panel text-left text-[10px] uppercase tracking-wider text-dim">
            <tr className="border-b border-line">
              <th className="px-2 py-1 font-medium">Topic</th>
              <th className="px-2 py-1 font-medium">Type</th>
              <th className="px-2 py-1 font-medium">Publisher</th>
              <th className="px-2 py-1 text-right font-medium">Rate</th>
              <th className="px-2 py-1 text-right font-medium">Expected</th>
              <th className="px-2 py-1 text-right font-medium">Msgs</th>
              <th className="px-2 py-1 text-right font-medium">Last update</th>
              <th className="px-2 py-1 text-right font-medium">Subs</th>
              <th className="px-2 py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {topics.map((t) => (
              <tr
                key={t.name}
                onClick={() => subscribeTopic(t.name === selected ? null : t.name)}
                className={cx('cursor-pointer border-b border-line/50 hover:bg-panel2', t.name === selected && 'bg-accent/10')}
              >
                <td className="px-2 py-0.5 text-accent">{t.name}</td>
                <td className="px-2 py-0.5 text-dim">{t.type}</td>
                <td className="px-2 py-0.5 text-dim">{t.publisher}</td>
                <td className="px-2 py-0.5 text-right">{t.frequency.toFixed(1)} Hz</td>
                <td className="px-2 py-0.5 text-right text-mute">{t.expectedHz ? `${t.expectedHz} Hz` : 'event'}</td>
                <td className="px-2 py-0.5 text-right">{t.messageCount}</td>
                <td className="px-2 py-0.5 text-right text-dim">{ago(t.lastWallTime)}</td>
                <td className="px-2 py-0.5 text-right text-mute">{t.subscribers}</td>
                <td className="px-2 py-0.5">
                  <Badge tone={t.status === 'ACTIVE' ? 'ok' : t.status === 'STALE' ? 'bad' : 'dim'}>{t.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {topics.length === 0 && <div className="p-3 text-dim">No topics yet.</div>}
      </div>

      {selected && (
        <div className="flex w-[46%] min-w-[360px] flex-col border-l border-line">
          <div className="flex items-center gap-2 border-b border-line px-2 py-1">
            <span className="font-mono text-[12px] text-accent">{selected}</span>
            <span className="font-mono text-[10px] text-dim">{selInfo?.type}</span>
            <span className="ml-auto font-mono text-[10px] text-dim">
              {selInfo ? `${selInfo.frequency.toFixed(1)} Hz · seq ${last?.seq ?? '—'} · t=${last?.simTime.toFixed(3) ?? '—'}s` : ''}
            </span>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-2">
            <div className="min-h-0 overflow-hidden p-1">
              <JsonView value={last ? prettyJson(last.data) : 'waiting for messages…'} className="h-full" />
            </div>
            <div className="flex min-h-0 flex-col border-l border-line">
              <div className="flex items-center gap-1 px-2 py-1">
                <span className="label">Plot</span>
                <Select value={plotField} width="w-full" options={paths.length ? paths : ['']} onChange={setField} />
              </div>
              <div className="h-28 px-1">
                {plotData.length < 2 ? (
                  <div className="flex h-full items-center justify-center text-[10px] text-mute">collecting samples…</div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={plotData} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                    <XAxis dataKey="t" type="number" domain={paddedDomain(plotData, ['t'])} tickCount={3} tick={{ fontSize: 9, fill: '#47546a' }} tickFormatter={(v: number) => v.toFixed(1)} stroke="#1f2935" />
                    <YAxis tick={{ fontSize: 9, fill: '#47546a' }} stroke="#1f2935" domain={paddedDomain(plotData, ['v'])} tickCount={3} width={50} tickFormatter={(v: number) => v.toFixed(2)} />
                    <Tooltip contentStyle={{ background: '#0f141b', border: '1px solid #2a3646', fontSize: 10 }} />
                    <Line dataKey="v" stroke="#22d3ee" dot={false} isAnimationActive={false} strokeWidth={1.3} />
                  </LineChart>
                </ResponsiveContainer>
                )}
              </div>
              <div className="label px-2 pt-1">Realtime messages</div>
              <div className="min-h-0 flex-1 overflow-auto px-2 font-mono text-[10px]">
                {messages
                  .slice(-60)
                  .reverse()
                  .map((m) => (
                    <div key={`${m.seq}-${m.simTime}`} className="flex gap-2 border-b border-line/40 py-px text-dim">
                      <span className="text-mute">#{m.seq}</span>
                      <span>{m.simTime.toFixed(3)}s</span>
                      <span className="truncate text-fg">{summarize(m.data)}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function summarize(d: unknown): string {
  const s = JSON.stringify(d, (_k, v) => (Array.isArray(v) && v.length > 6 ? `[${v.length}]` : typeof v === 'number' && !Number.isInteger(v) ? +v.toFixed(3) : v));
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}
