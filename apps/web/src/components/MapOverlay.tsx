import { deg, fmt } from '../lib/format';
import { api } from '../lib/api';
import { displayScenario, useStore, type EditorTool, type Layers } from '../store';
import { Btn, cx } from './ui';

const TOOLS: Array<{ id: EditorTool; label: string; hint: string }> = [
  { id: 'none', label: '✋ Pan', hint: 'Navigate the map' },
  { id: 'select', label: '↖ Move', hint: 'Select / drag obstacles, rover, target, waypoints' },
  { id: 'rect', label: '▭ Rect', hint: 'Drag to draw a rectangular obstacle' },
  { id: 'circle', label: '◯ Circle', hint: 'Drag to draw a circular obstacle' },
  { id: 'target', label: '⊕ Target', hint: 'Click to set the target' },
  { id: 'waypoint', label: '◆ Waypoint', hint: 'Click to append a waypoint' },
  { id: 'rover', label: '▲ Rover', hint: 'Click to place, drag to set heading' },
  { id: 'delete', label: '✕ Delete', hint: 'Click an item to delete it' },
];

const LAYERS: Array<{ id: keyof Layers; label: string }> = [
  { id: 'grid', label: 'GRID' },
  { id: 'lidar', label: 'LIDAR' },
  { id: 'trail', label: 'TRAIL' },
  { id: 'odom', label: 'ODOM' },
  { id: 'safety', label: 'SAFETY' },
  { id: 'follow', label: 'FOLLOW' },
];

export function MapToolbar() {
  const tool = useStore((s) => s.tool);
  const layers = useStore((s) => s.layers);
  const status = useStore((s) => s.status);
  const replay = useStore((s) => s.replay);
  const set = useStore((s) => s.set);

  const pickTool = (t: EditorTool) => {
    if (t !== 'none' && status === 'RUNNING') void api.control('pause');
    set({ tool: t, selectedObstacle: t === 'select' ? useStore.getState().selectedObstacle : null });
  };

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
      <span className="label">Editor</span>
      <div className={cx('flex gap-0.5', replay && 'pointer-events-none opacity-40')}>
        {TOOLS.map((t) => (
          <Btn key={t.id} variant="ghost" active={tool === t.id} title={t.hint} onClick={() => pickTool(t.id)} className="h-5 px-1.5 text-[10px]">
            {t.label}
          </Btn>
        ))}
      </div>
      <div className="ml-auto flex gap-0.5">
        {LAYERS.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => set({ layers: { ...layers, [l.id]: !layers[l.id] } })}
            className={cx('h-5 rounded-sm border px-1.5 font-mono text-[9px] font-semibold', layers[l.id] ? 'border-accent/60 bg-accent/15 text-accent' : 'border-line2 bg-panel/80 text-mute')}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function MapOverlay() {
  const frame = useStore((s) => (s.replay ? s.replay.run.frames[s.replay.index] : s.frame));
  const tool = useStore((s) => s.tool);
  const replay = useStore((s) => s.replay);
  const debugMode = useStore((s) => s.debugMode);
  const debug = useStore((s) => s.debug);
  const fps = useStore((s) => s.renderFps);
  const scenarioName = useStore((s) => displayScenario(s)?.name);

  const f = frame;
  return (
    <>
      <div className="pointer-events-none absolute left-2 top-2 w-52 rounded-sm border border-line bg-panel/85 p-2 font-mono text-[11px] backdrop-blur-sm">
        <div className="mb-1 flex items-center justify-between">
          <span className="label">Pose · ground truth</span>
          <span className="text-[9px] text-mute">{scenarioName}</span>
        </div>
        <Row k="X" v={fmt(f?.pose.x, 2, ' m')} />
        <Row k="Y" v={fmt(f?.pose.y, 2, ' m')} />
        <Row k="HEADING" v={f ? `${deg(f.pose.heading).toFixed(1)}°` : '—'} />
        <Row k="SPEED" v={fmt(f?.velocity.linear, 2, ' m/s')} />
        <Row k="ANG VEL" v={fmt(f?.velocity.angular, 2, ' rad/s')} />
        <div className="mt-1 border-t border-line pt-1">
          <Row k="CMD_VEL" v={f ? `${f.cmdVel.linear.toFixed(2)} / ${f.cmdVel.angular.toFixed(2)}` : '—'} />
          <Row
            k="SAFETY"
            v={f?.safety ? `${f.safety.verdict}` : '—'}
            cls={f?.safety?.verdict === 'ALLOW' ? 'text-ok' : f?.safety?.verdict === 'OVERRIDE' ? 'text-warn' : 'text-bad'}
          />
          {f?.collision && <div className="mt-1 text-center font-bold text-bad blink">COLLISION</div>}
        </div>
      </div>

      {tool !== 'none' && !replay && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-sm bg-warn/15 px-2 py-0.5 font-mono text-[10px] text-warn">
          EDIT MODE · changes reload the scenario and reset the simulation
        </div>
      )}

      {debugMode && (
        <div className="pointer-events-none absolute bottom-8 left-2 w-56 rounded-sm border border-violet/40 bg-panel/90 p-2 font-mono text-[10px] text-dim">
          <div className="label mb-1 text-violet">Debug</div>
          <Row k="sim tick" v={`${debug?.ticks ?? 0} @ ${fmt(debug?.simTickRate, 0)} Hz`} />
          <Row k="realtime ×" v={fmt(debug?.realtimeFactor, 2)} />
          <Row k="step" v={fmt(debug?.stepDurationMs, 3, ' ms')} />
          <Row k="AI rate" v={fmt(debug?.aiTickRate, 2, ' Hz')} />
          <Row k="AI latency" v={fmt(f?.ai.latencyMs, 0, ' ms')} />
          <Row k="/scan" v={fmt(debug?.sensorTickRates['/scan'], 1, ' Hz')} />
          <Row k="/imu" v={fmt(debug?.sensorTickRates['/imu'], 1, ' Hz')} />
          <Row k="WS msgs" v={fmt(debug?.wsMessageRate, 0, '/s')} />
          <Row k="render" v={`${fps} fps`} />
          <Row k="server RSS" v={fmt(debug?.memoryMb, 0, ' MB')} />
          <Row k="loop lag" v={fmt(debug?.loopLagMs, 1, ' ms')} />
        </div>
      )}
    </>
  );
}

function Row({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-mute">{k}</span>
      <span className={cx('num', cls ?? 'text-fg')}>{v}</span>
    </div>
  );
}
