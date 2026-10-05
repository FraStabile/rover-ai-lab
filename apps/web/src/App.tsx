import { useRef, useState } from 'react';
import { MapCanvas } from './components/MapCanvas';
import { MapOverlay, MapToolbar } from './components/MapOverlay';
import { ManualPad } from './components/ManualPad';
import { ReplayBar } from './components/ReplayBar';
import { TelemetryPanel } from './components/TelemetryPanel';
import { TopBar } from './components/TopBar';
import { Tabs, cx } from './components/ui';
import { AiInspectorPanel, DebugPanel, LogsPanel, RunsPanel, StatePanel } from './panels/BottomPanels';
import { AiPanel, FailurePanel, RobotPanel, SensorsPanel, SimPanel } from './panels/ConfigPanels';
import { ScenarioPanel } from './panels/ScenarioPanel';
import { TopicsPanel } from './panels/TopicsPanel';
import { useStore, type BottomTab, type LeftTab } from './store';

export function App() {
  const leftTab = useStore((s) => s.leftTab);
  const bottomTab = useStore((s) => s.bottomTab);
  const failures = useStore((s) => s.config?.failures);
  const errors = useStore((s) => s.logs.filter((l) => l.level === 'error').length);
  const toasts = useStore((s) => s.toasts);
  const connected = useStore((s) => s.connected);
  const set = useStore((s) => s.set);
  const [bottomH, setBottomH] = useState(280);
  const dragging = useRef<{ y: number; h: number } | null>(null);

  const activeFailures = failures
    ? [failures.lidar, failures.gps, failures.imu, failures.odom, failures.leftMotor !== 'none', failures.rightMotor !== 'none', failures.batteryDrain !== 1, failures.aiTimeout, failures.aiInvalidResponse, failures.aiLatencyMs > 0, failures.networkLatencyMs > 0, failures.sensorNoiseMultiplier !== 1].filter(Boolean).length
    : 0;

  const leftTabs: Array<{ id: LeftTab; label: string; badge?: React.ReactNode }> = [
    { id: 'scenario', label: 'Scenario' },
    { id: 'robot', label: 'Robot' },
    { id: 'sensors', label: 'Sensors' },
    { id: 'ai', label: 'AI' },
    { id: 'sim', label: 'Sim' },
    { id: 'faults', label: 'Faults', badge: activeFailures ? <span className="rounded-sm bg-bad/30 px-1 text-[9px] text-bad">{activeFailures}</span> : undefined },
  ];
  const bottomTabs: Array<{ id: BottomTab; label: string; badge?: React.ReactNode }> = [
    { id: 'topics', label: 'ROS2 Topics' },
    { id: 'logs', label: 'Logs', badge: errors ? <span className="rounded-sm bg-bad/30 px-1 text-[9px] text-bad">{errors}</span> : undefined },
    { id: 'inspector', label: 'AI Inspector' },
    { id: 'state', label: 'State JSON' },
    { id: 'runs', label: 'Runs / Replay' },
    { id: 'debug', label: 'Debug' },
  ];

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      {!connected && <div className="bg-bad/20 px-3 py-0.5 text-center font-mono text-[11px] text-bad">Backend not reachable — reconnecting… (start it with `npm run dev`)</div>}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[310px] shrink-0 flex-col border-r border-line bg-panel">
          <Tabs value={leftTab} onChange={(v) => set({ leftTab: v })} tabs={leftTabs} className="flex-wrap" />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {leftTab === 'scenario' && <ScenarioPanel />}
            {leftTab === 'robot' && <RobotPanel />}
            {leftTab === 'sensors' && <SensorsPanel />}
            {leftTab === 'ai' && <AiPanel />}
            {leftTab === 'sim' && <SimPanel />}
            {leftTab === 'faults' && <FailurePanel />}
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <MapToolbar />
          <div className="relative min-h-0 flex-1">
            <MapCanvas />
            <MapOverlay />
            <ReplayBar />
          </div>
          <ManualPad />
        </main>
        <aside className="w-[300px] shrink-0 border-l border-line bg-panel">
          <div className="label border-b border-line px-3 py-2 text-accent">Telemetry</div>
          <div className="h-[calc(100%-33px)]">
            <TelemetryPanel />
          </div>
        </aside>
      </div>
      <div
        className="h-1 shrink-0 cursor-row-resize bg-line hover:bg-accent/50"
        onMouseDown={(e) => {
          dragging.current = { y: e.clientY, h: bottomH };
          const move = (ev: MouseEvent) => dragging.current && setBottomH(Math.max(120, Math.min(window.innerHeight - 300, dragging.current.h - (ev.clientY - dragging.current.y))));
          const up = () => {
            dragging.current = null;
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
          };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        }}
      />
      <section className="flex shrink-0 flex-col bg-panel" style={{ height: bottomH }}>
        <Tabs value={bottomTab} onChange={(v) => set({ bottomTab: v })} tabs={bottomTabs} />
        <div className="min-h-0 flex-1">
          {bottomTab === 'topics' && <TopicsPanel />}
          {bottomTab === 'logs' && <LogsPanel />}
          {bottomTab === 'inspector' && <AiInspectorPanel />}
          {bottomTab === 'state' && <StatePanel />}
          {bottomTab === 'runs' && <RunsPanel />}
          {bottomTab === 'debug' && <DebugPanel />}
        </div>
      </section>
      <div className="pointer-events-none fixed bottom-3 right-3 z-50 flex flex-col gap-1">
        {toasts.map((t) => (
          <div key={t.id} className={cx('rounded-sm border px-3 py-1.5 font-mono text-[11px] shadow-lg', t.kind === 'error' ? 'border-bad/60 bg-[#2a0f16] text-bad' : 'border-accent/50 bg-panel2 text-fg')}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
