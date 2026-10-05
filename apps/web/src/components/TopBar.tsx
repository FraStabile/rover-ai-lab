import type { AiLinkStatus, DevMode } from '@rover/protocol';
import { SIM_SPEEDS } from '@rover/protocol';
import { api } from '../lib/api';
import { fmtDuration } from '../lib/format';
import { useStore } from '../store';
import { Badge, Btn, Select, cx, useAction, usePatch, type Tone } from './ui';

const AI_TONE: Record<AiLinkStatus, Tone> = {
  DISABLED: 'dim',
  MOCK: 'violet',
  CONNECTED: 'ok',
  OFFLINE: 'bad',
  TIMEOUT: 'warn',
  ERROR: 'bad',
  UNKNOWN: 'dim',
};

const DEV_MODES: Array<{ value: DevMode; label: string }> = [
  { value: 'SIMULATION', label: 'SIMULATION' },
  { value: 'SIMULATION_LOCAL_AI', label: 'SIM + LOCAL AI' },
  { value: 'REAL_ROBOT', label: 'REAL ROBOT' },
];

export function TopBar() {
  const status = useStore((s) => s.status);
  const mode = useStore((s) => s.mode);
  const devMode = useStore((s) => s.devMode);
  const connected = useStore((s) => s.connected);
  const frame = useStore((s) => s.frame);
  const config = useStore((s) => s.config);
  const replay = useStore((s) => s.replay);
  const debugMode = useStore((s) => s.debugMode);
  const set = useStore((s) => s.set);
  const act = useAction();
  const patch = usePatch();

  const running = status === 'RUNNING';
  const ai = frame?.ai.status ?? 'UNKNOWN';
  const aiLabel = ai === 'MOCK' ? 'MOCK' : ai === 'CONNECTED' ? 'CONNECTED' : ai === 'UNKNOWN' ? 'CHECKING' : ai === 'OFFLINE' ? 'OFFLINE' : ai;
  const estop = frame?.estop ?? false;

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <div className="flex items-center gap-2 pr-2">
        <img src="/rover.svg" className="h-6 w-6" alt="" />
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-wide text-white">Rover AI Lab</div>
          <div className="font-mono text-[9px] text-mute">sim · autonomy · jev</div>
        </div>
      </div>

      <div className="h-6 w-px bg-line" />

      <Select<DevMode> value={devMode} options={DEV_MODES} width="w-36" onChange={(v) => act(() => api.setDevMode(v))} />

      <div className="flex overflow-hidden rounded-sm border border-line2">
        {(['MANUAL', 'AUTO'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => act(() => api.setMode(m))}
            className={cx('h-6 px-2.5 text-[10px] font-bold tracking-widest', mode === m ? (m === 'AUTO' ? 'bg-violet/20 text-violet' : 'bg-accent/20 text-accent') : 'text-dim hover:text-fg')}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="h-6 w-px bg-line" />

      <div className="flex items-center gap-1">
        {running ? (
          <Btn variant="warn" onClick={() => act(() => api.control('pause'))} disabled={!!replay}>
            ❚❚ PAUSE
          </Btn>
        ) : (
          <Btn variant="ok" onClick={() => act(() => api.control('run'))} disabled={!!replay || status === 'UNAVAILABLE'}>
            ▶ RUN
          </Btn>
        )}
        <Btn onClick={() => act(() => api.control('step'))} disabled={!!replay || status === 'UNAVAILABLE'} title="Advance one physics tick">
          STEP
        </Btn>
        <Btn onClick={() => act(() => api.control('step', 50))} disabled={!!replay || status === 'UNAVAILABLE'} title="Advance 50 ticks">
          +50
        </Btn>
        <Btn onClick={() => act(() => api.control('reset'))} disabled={!!replay}>
          ⟲ RESET
        </Btn>
        <Select<number>
          value={config?.simulation.speed ?? 1}
          width="w-16"
          options={SIM_SPEEDS.map((s) => ({ value: s, label: `×${s}` }))}
          onChange={(v) => patch({ simulation: { speed: v } })}
        />
      </div>

      <Btn
        variant="danger"
        active={estop}
        className={cx('px-3 font-bold', estop && 'bg-bad/40 text-white')}
        onClick={() => act(() => api.estop(!estop))}
        title="Latching emergency stop (handled by the SafetyController)"
      >
        {estop ? '■ E-STOP ENGAGED' : '■ E-STOP'}
      </Btn>

      <div className="ml-auto flex items-center gap-3">
        <div className="text-right leading-tight">
          <div className="num text-[13px] text-white">{(frame?.simTime ?? 0).toFixed(2)}s</div>
          <div className="font-mono text-[9px] text-mute">SIM TIME · {fmtDuration(frame?.mission.elapsed ?? 0)} mission</div>
        </div>
        <Badge tone={status === 'RUNNING' ? 'ok' : status === 'UNAVAILABLE' ? 'bad' : 'warn'}>
          {status === 'RUNNING' && <span className="blink mr-1">●</span>}
          {replay ? 'REPLAY' : status}
        </Badge>
        <Badge tone={devMode === 'REAL_ROBOT' ? 'bad' : devMode === 'SIMULATION_LOCAL_AI' ? 'violet' : 'accent'}>{devMode.replace(/_/g, ' ')}</Badge>
        <Badge tone={AI_TONE[ai]}>AI: {aiLabel}</Badge>
        <Badge tone={connected ? 'ok' : 'bad'}>{connected ? 'WS LINK' : 'WS DOWN'}</Badge>
        <Btn variant="ghost" active={debugMode} onClick={() => set({ debugMode: !debugMode })} title="Debug overlay">
          DBG
        </Btn>
      </div>
    </header>
  );
}
