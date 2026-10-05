import { useEffect, useState } from 'react';
import { AI_INTERVALS_MS, SIM_RATES, SIM_SPEEDS, type AiProvider, type AppConfig, type MotorFault } from '@rover/protocol';
import { Badge, Btn, Field, JsonView, NumField, Section, Select, TextArea, TextField, Toggle, cx, useAction, usePatch } from '../components/ui';
import { api } from '../lib/api';
import { prettyJson } from '../lib/format';
import { useStore } from '../store';

function useConfig(): AppConfig | null {
  return useStore((s) => s.config);
}

// ------------------------------------------------------------------- ROBOT

export function RobotPanel() {
  const c = useConfig();
  const patch = usePatch();
  const act = useAction();
  const [presets, setPresets] = useState<Array<{ id: string; name: string }>>([]);
  const [name, setName] = useState('');
  const refresh = async () => setPresets((await act(() => api.listRobotConfigs())) ?? []);
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!c) return null;
  const r = c.robot;
  const b = c.battery;
  const rp = (p: Partial<AppConfig['robot']>) => patch({ robot: p });
  const bp = (p: Partial<AppConfig['battery']>) => patch({ battery: p });
  return (
    <>
      <Section title="Kinematics & dynamics">
        <Field label="Mass"><NumField value={r.mass} step={1} min={1} unit="kg" onCommit={(v) => rp({ mass: v })} /></Field>
        <Field label="Max speed"><NumField value={r.maxSpeed} min={0.1} max={20} unit="m/s" onCommit={(v) => rp({ maxSpeed: v })} /></Field>
        <Field label="Max acceleration"><NumField value={r.maxAcceleration} min={0.05} max={20} unit="m/s²" onCommit={(v) => rp({ maxAcceleration: v })} /></Field>
        <Field label="Max angular velocity"><NumField value={r.maxAngularVelocity} min={0.05} max={10} unit="rad/s" onCommit={(v) => rp({ maxAngularVelocity: v })} /></Field>
        <Field label="Turn rate (fraction)" hint="Fraction of max angular velocity used by TURN actions"><NumField value={r.turnRate} step={0.05} min={0.05} max={1} onCommit={(v) => rp({ turnRate: v })} /></Field>
        <Field label="Wheel base"><NumField value={r.wheelBase} step={0.05} min={0.1} max={5} unit="m" onCommit={(v) => rp({ wheelBase: v })} /></Field>
        <Field label="Wheel radius"><NumField value={r.wheelRadius} step={0.01} min={0.01} max={2} unit="m" onCommit={(v) => rp({ wheelRadius: v })} /></Field>
        <Field label="Length × width"><NumField value={r.length} step={0.05} min={0.1} max={5} width="w-14" onCommit={(v) => rp({ length: v })} /><NumField value={r.width} step={0.05} min={0.1} max={5} width="w-14" onCommit={(v) => rp({ width: v })} /></Field>
        <Field label="Friction"><NumField value={r.friction} step={0.01} min={0} max={0.9} onCommit={(v) => rp({ friction: v })} /></Field>
      </Section>
      <Section title="Battery">
        <Field label="Capacity"><NumField value={b.capacity} step={5} min={1} unit="Wh" onCommit={(v) => bp({ capacity: v })} /></Field>
        <Field label="Initial charge" hint="Applied on reset"><NumField value={b.initialCharge} step={0.05} min={0} max={1} onCommit={(v) => bp({ initialCharge: v })} /></Field>
        <Field label="Consumption idle"><NumField value={b.consumptionIdle} step={1} min={0} unit="W" onCommit={(v) => bp({ consumptionIdle: v })} /></Field>
        <Field label="Consumption moving"><NumField value={b.consumptionMoving} step={5} min={0} unit="W" onCommit={(v) => bp({ consumptionMoving: v })} /></Field>
        <Field label="Consumption turning"><NumField value={b.consumptionTurning} step={5} min={0} unit="W" onCommit={(v) => bp({ consumptionTurning: v })} /></Field>
        <Field label="Consumption ×"><NumField value={b.consumptionMultiplier} step={0.1} min={0} max={100} onCommit={(v) => bp({ consumptionMultiplier: v })} /></Field>
        <Field label="Nominal voltage"><NumField value={b.nominalVoltage} step={1} min={1} unit="V" onCommit={(v) => bp({ nominalVoltage: v })} /></Field>
        <Field label="Low / critical"><NumField value={b.lowThreshold} step={0.01} min={0} max={1} width="w-14" onCommit={(v) => bp({ lowThreshold: v })} /><NumField value={b.criticalThreshold} step={0.01} min={0} max={1} width="w-14" onCommit={(v) => bp({ criticalThreshold: v })} /></Field>
      </Section>
      <Section title="Robot configurations (DB)">
        <Field label="Save current as">
          <TextField value={name} mono={false} width="w-28" placeholder="name" onCommit={setName} />
          <Btn variant="primary" disabled={!name} onClick={() => act(async () => { await api.saveRobotConfig(name); await refresh(); }, 'Configuration saved')}>SAVE</Btn>
        </Field>
        {presets.map((p) => (
          <div key={p.id} className="flex items-center gap-1">
            <span className="flex-1 truncate text-[11px]">{p.name}</span>
            <Btn onClick={() => act(() => api.applyRobotConfig(p.id), `Applied "${p.name}"`)}>APPLY</Btn>
            <Btn variant="ghost" onClick={() => act(async () => { await api.deleteRobotConfig(p.id); await refresh(); })}>✕</Btn>
          </div>
        ))}
      </Section>
    </>
  );
}

// ------------------------------------------------------------------- SENSORS

export function SensorsPanel() {
  const c = useConfig();
  const patch = usePatch();
  if (!c) return null;
  const s = c.sensors;
  return (
    <>
      <Section title="LiDAR · /scan">
        <Field label="Enabled"><Toggle checked={s.lidar.enabled} onChange={(v) => patch({ sensors: { lidar: { enabled: v } } })} /></Field>
        <Field label="Range"><NumField value={s.lidar.range} step={0.5} min={0.5} max={100} unit="m" onCommit={(v) => patch({ sensors: { lidar: { range: v } } })} /></Field>
        <Field label="Field of view"><NumField value={s.lidar.fieldOfView} step={10} min={10} max={360} unit="°" onCommit={(v) => patch({ sensors: { lidar: { fieldOfView: v } } })} /></Field>
        <Field label="Rays"><NumField value={s.lidar.numberOfRays} step={10} min={2} max={2000} onCommit={(v) => patch({ sensors: { lidar: { numberOfRays: v } } })} /></Field>
        <Field label="Update frequency"><NumField value={s.lidar.updateFrequency} step={1} min={0} max={200} unit="Hz" onCommit={(v) => patch({ sensors: { lidar: { updateFrequency: v } } })} /></Field>
        <Field label="Noise σ"><NumField value={s.lidar.noise} step={0.005} min={0} max={2} unit="m" onCommit={(v) => patch({ sensors: { lidar: { noise: v } } })} /></Field>
        <Field label="Dropout probability"><NumField value={s.lidar.dropout} step={0.01} min={0} max={1} onCommit={(v) => patch({ sensors: { lidar: { dropout: v } } })} /></Field>
      </Section>
      <Section title="IMU · /imu">
        <Field label="Enabled"><Toggle checked={s.imu.enabled} onChange={(v) => patch({ sensors: { imu: { enabled: v } } })} /></Field>
        <Field label="Update frequency"><NumField value={s.imu.updateFrequency} step={5} min={0} max={500} unit="Hz" onCommit={(v) => patch({ sensors: { imu: { updateFrequency: v } } })} /></Field>
        <Field label="Accel noise σ"><NumField value={s.imu.accelNoise} step={0.01} min={0} unit="m/s²" onCommit={(v) => patch({ sensors: { imu: { accelNoise: v } } })} /></Field>
        <Field label="Gyro noise σ"><NumField value={s.imu.gyroNoise} step={0.005} min={0} unit="rad/s" onCommit={(v) => patch({ sensors: { imu: { gyroNoise: v } } })} /></Field>
        <Field label="Orientation noise σ"><NumField value={s.imu.orientationNoise} step={0.005} min={0} unit="rad" onCommit={(v) => patch({ sensors: { imu: { orientationNoise: v } } })} /></Field>
        <Field label="Gyro bias walk"><NumField value={s.imu.gyroBias} step={0.001} min={0} onCommit={(v) => patch({ sensors: { imu: { gyroBias: v } } })} /></Field>
      </Section>
      <Section title="Odometry · /odom">
        <Field label="Enabled"><Toggle checked={s.odom.enabled} onChange={(v) => patch({ sensors: { odom: { enabled: v } } })} /></Field>
        <Field label="Update frequency"><NumField value={s.odom.updateFrequency} step={5} min={0} max={500} unit="Hz" onCommit={(v) => patch({ sensors: { odom: { updateFrequency: v } } })} /></Field>
        <Field label="Encoder noise (rel.)"><NumField value={s.odom.noise} step={0.001} min={0} max={1} onCommit={(v) => patch({ sensors: { odom: { noise: v } } })} /></Field>
      </Section>
      <Section title="GPS · /gps">
        <Field label="Enabled"><Toggle checked={s.gps.enabled} onChange={(v) => patch({ sensors: { gps: { enabled: v } } })} /></Field>
        <Field label="Update frequency"><NumField value={s.gps.updateFrequency} step={1} min={0} max={50} unit="Hz" onCommit={(v) => patch({ sensors: { gps: { updateFrequency: v } } })} /></Field>
        <Field label="Noise σ"><NumField value={s.gps.noise} step={0.1} min={0} max={50} unit="m" onCommit={(v) => patch({ sensors: { gps: { noise: v } } })} /></Field>
        <Field label="Origin lat / lon"><NumField value={s.gps.originLatitude} step={0.0001} width="w-20" onCommit={(v) => patch({ sensors: { gps: { originLatitude: v } } })} /><NumField value={s.gps.originLongitude} step={0.0001} width="w-20" onCommit={(v) => patch({ sensors: { gps: { originLongitude: v } } })} /></Field>
      </Section>
      <Section title="Other topics">
        <Field label="/battery rate"><NumField value={s.batteryFrequency} step={1} min={0} max={100} unit="Hz" onCommit={(v) => patch({ sensors: { batteryFrequency: v } })} /></Field>
        <Field label="/motor_state rate"><NumField value={s.motorFrequency} step={1} min={0} max={200} unit="Hz" onCommit={(v) => patch({ sensors: { motorFrequency: v } })} /></Field>
      </Section>
    </>
  );
}

// ------------------------------------------------------------------- AI

export function AiPanel() {
  const c = useConfig();
  const patch = usePatch();
  const act = useAction();
  const [test, setTest] = useState<unknown>(null);
  const [testing, setTesting] = useState(false);
  if (!c) return null;
  const ai = c.ai;
  const j = ai.jev;
  const cu = ai.custom;
  const sf = c.safety;
  const pl = c.planner;

  const runTest = async () => {
    setTesting(true);
    const r = await act(() => api.testJev());
    setTest(r ?? null);
    setTesting(false);
  };

  const parseJsonObject = (text: string): Record<string, string> | null => {
    try {
      const v = JSON.parse(text) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, string>;
    } catch {
      // ignore
    }
    useStore.getState().toast('Invalid JSON object', 'error');
    return null;
  };

  return (
    <>
      <Section title="AI engine">
        <div className="grid grid-cols-3 gap-1">
          {(
            [
              ['mock', 'Mock'],
              ['local-jev', 'Local Jev'],
              ['custom-http', 'Custom HTTP'],
            ] as Array<[AiProvider, string]>
          ).map(([id, label]) => (
            <Btn key={id} active={ai.provider === id} onClick={() => patch({ ai: { provider: id } })}>
              {label}
            </Btn>
          ))}
        </div>
        <Field label="Decision interval">
          <Select<number> value={ai.decisionIntervalMs} width="w-24" options={[...new Set([...AI_INTERVALS_MS, ai.decisionIntervalMs])].sort((a, b) => a - b).map((v) => ({ value: v, label: `${v} ms` }))} onChange={(v) => patch({ ai: { decisionIntervalMs: v } })} />
        </Field>
        <Field label="Timeout"><NumField value={ai.timeoutMs} step={50} min={10} max={120000} unit="ms" onCommit={(v) => patch({ ai: { timeoutMs: v } })} /></Field>
        <Field label="Retries"><NumField value={ai.retries} step={1} min={0} max={5} onCommit={(v) => patch({ ai: { retries: v } })} /></Field>
        <Field label="Stale after" hint="A decision older than this is treated as AI_TIMEOUT"><NumField value={ai.staleAfterMs} step={100} min={100} unit="ms" onCommit={(v) => patch({ ai: { staleAfterMs: v } })} /></Field>
        <Field label="Timing" hint="lockstep: the simulation waits for each AI answer (deterministic)">
          <Select value={ai.syncMode} options={['realtime', 'lockstep'] as const} onChange={(v) => patch({ ai: { syncMode: v } })} />
        </Field>
      </Section>

      {ai.provider === 'local-jev' && (
        <Section title="Local Jev endpoint">
          <Field label="Base URL"><TextField value={j.baseUrl} width="w-44" onCommit={(v) => patch({ ai: { jev: { baseUrl: v } } })} /></Field>
          <Field label="Model"><TextField value={j.model} width="w-44" onCommit={(v) => patch({ ai: { jev: { model: v } } })} /></Field>
          <Field label="Protocol">
            <Select value={j.protocol} width="w-32" options={[{ value: 'native', label: 'native JSON' }, { value: 'openai-chat', label: 'OpenAI chat' }] as const} onChange={(v) => patch({ ai: { jev: { protocol: v } } })} />
          </Field>
          <Field label="Decide path"><TextField value={j.decidePath} width="w-44" onCommit={(v) => patch({ ai: { jev: { decidePath: v } } })} /></Field>
          <Field label="Health path"><TextField value={j.healthPath} width="w-44" onCommit={(v) => patch({ ai: { jev: { healthPath: v } } })} /></Field>
          <Field label="Temperature"><NumField value={j.temperature} step={0.1} min={0} max={2} onCommit={(v) => patch({ ai: { jev: { temperature: v } } })} /></Field>
          <div className="label pt-1">Headers (JSON)</div>
          <TextArea value={JSON.stringify(j.headers)} rows={2} onCommit={(v) => { const h = parseJsonObject(v); if (h) void patch({ ai: { jev: { headers: h } } }); }} />
        </Section>
      )}

      {ai.provider === 'custom-http' && (
        <Section title="Custom HTTP endpoint">
          <Field label="URL"><TextField value={cu.url} width="w-44" onCommit={(v) => patch({ ai: { custom: { url: v } } })} /></Field>
          <Field label="Method"><Select value={cu.method} width="w-20" options={['POST', 'PUT', 'GET'] as const} onChange={(v) => patch({ ai: { custom: { method: v } } })} /></Field>
          <Field label="Health URL"><TextField value={cu.healthUrl} width="w-44" placeholder="(optional)" onCommit={(v) => patch({ ai: { custom: { healthUrl: v } } })} /></Field>
          <div className="label pt-1">Headers (JSON)</div>
          <TextArea value={JSON.stringify(cu.headers)} rows={2} onCommit={(v) => { const h = parseJsonObject(v); if (h) void patch({ ai: { custom: { headers: h } } }); }} />
          <div className="label pt-1">Request template · {'{{state}} {{model}} {{actions}} {{state.robot.x}}'}</div>
          <TextArea value={cu.requestTemplate} rows={6} onCommit={(v) => patch({ ai: { custom: { requestTemplate: v } } })} />
          <div className="label pt-1">Response mapping (dotted paths)</div>
          <Field label="action"><TextField value={cu.responseMapping.action} width="w-44" onCommit={(v) => patch({ ai: { custom: { responseMapping: { action: v } } } })} /></Field>
          <Field label="confidence"><TextField value={cu.responseMapping.confidence} width="w-44" onCommit={(v) => patch({ ai: { custom: { responseMapping: { confidence: v } } } })} /></Field>
          <Field label="reason"><TextField value={cu.responseMapping.reason} width="w-44" onCommit={(v) => patch({ ai: { custom: { responseMapping: { reason: v } } } })} /></Field>
          <div className="label pt-1">Action map (JSON, provider → internal)</div>
          <TextArea value={JSON.stringify(cu.actionMap)} rows={2} onCommit={(v) => { const h = parseJsonObject(v); if (h) void patch({ ai: { custom: { actionMap: h } } }); }} />
        </Section>
      )}

      {ai.provider !== 'mock' && (
        <Section title="Connection test" right={<Btn variant="primary" disabled={testing} onClick={runTest}>{testing ? 'TESTING…' : 'TEST'}</Btn>}>
          {test ? <TestResult r={test as TestShape} /> : <div className="text-[11px] text-mute">Runs a health check and one decision with the current state.</div>}
        </Section>
      )}

      <Section title="Safety controller (deterministic)">
        <Field label="Emergency stop distance"><NumField value={sf.emergencyStopDistance} step={0.05} min={0} max={10} unit="m" onCommit={(v) => patch({ safety: { emergencyStopDistance: v } })} /></Field>
        <Field label="Slow-down distance"><NumField value={sf.slowDownDistance} step={0.1} min={0} max={20} unit="m" onCommit={(v) => patch({ safety: { slowDownDistance: v } })} /></Field>
        <Field label="Slow-down factor"><NumField value={sf.slowDownFactor} step={0.05} min={0} max={1} onCommit={(v) => patch({ safety: { slowDownFactor: v } })} /></Field>
        <Field label="Min time to collision"><NumField value={sf.timeToCollision} step={0.1} min={0} max={10} unit="s" onCommit={(v) => patch({ safety: { timeToCollision: v } })} /></Field>
        <Field label="Max speed"><NumField value={sf.maxSpeed} step={0.1} min={0} max={20} unit="m/s" onCommit={(v) => patch({ safety: { maxSpeed: v } })} /></Field>
        <Field label="Max angular velocity"><NumField value={sf.maxAngularVelocity} step={0.1} min={0} max={10} unit="rad/s" onCommit={(v) => patch({ safety: { maxAngularVelocity: v } })} /></Field>
        <Field label="Motor temp limit"><NumField value={sf.motorTemperatureLimit} step={5} min={30} max={200} unit="°C" onCommit={(v) => patch({ safety: { motorTemperatureLimit: v } })} /></Field>
        <Field label="Sensor timeout"><NumField value={sf.sensorTimeout} step={0.1} min={0.05} max={10} unit="s" onCommit={(v) => patch({ safety: { sensorTimeout: v } })} /></Field>
        <Field label="On AI timeout">
          <Select value={sf.onAiTimeout} width="w-32" options={['STOP', 'SLOW_DOWN', 'CONTINUE_LAST'] as const} onChange={(v) => patch({ safety: { onAiTimeout: v } })} />
        </Field>
        <Field label="Apply in MANUAL"><Toggle checked={sf.applyInManual} onChange={(v) => patch({ safety: { applyInManual: v } })} /></Field>
      </Section>

      <Section title="Local planner">
        <Field label="Cruise speed"><NumField value={pl.cruiseSpeed} step={0.1} min={0} max={20} unit="m/s" onCommit={(v) => patch({ planner: { cruiseSpeed: v } })} /></Field>
        <Field label="Slow speed"><NumField value={pl.slowSpeed} step={0.05} min={0} max={20} unit="m/s" onCommit={(v) => patch({ planner: { slowSpeed: v } })} /></Field>
        <Field label="Turn linear speed"><NumField value={pl.turnLinearSpeed} step={0.05} min={0} max={5} unit="m/s" onCommit={(v) => patch({ planner: { turnLinearSpeed: v } })} /></Field>
        <Field label="Reverse speed"><NumField value={pl.reverseSpeed} step={0.05} min={0} max={5} unit="m/s" onCommit={(v) => patch({ planner: { reverseSpeed: v } })} /></Field>
        <Field label="Heading gain"><NumField value={pl.headingGain} step={0.1} min={0} max={20} onCommit={(v) => patch({ planner: { headingGain: v } })} /></Field>
        <Field label="Control rate (/cmd_vel)"><NumField value={pl.controlFrequency} step={5} min={1} max={200} unit="Hz" onCommit={(v) => patch({ planner: { controlFrequency: v } })} /></Field>
      </Section>
    </>
  );
}

interface TestShape {
  provider: string;
  health: { ok: boolean; latencyMs: number; message: string };
  result: { decision: unknown; error?: { code: string; message: string }; latencyMs: number };
}

function TestResult({ r }: { r: TestShape }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Badge tone={r.health.ok ? 'ok' : 'bad'}>{r.health.ok ? 'REACHABLE' : 'OFFLINE'}</Badge>
        <span className="num text-[10px] text-dim">{r.health.latencyMs} ms</span>
      </div>
      <div className="break-all text-[10px] text-dim">{r.health.message}</div>
      <div className="flex items-center gap-2">
        <Badge tone={r.result.decision ? 'ok' : 'bad'}>{r.result.decision ? 'DECISION OK' : (r.result.error?.code ?? 'ERROR')}</Badge>
        <span className="num text-[10px] text-dim">{r.result.latencyMs} ms</span>
      </div>
      {r.result.error && <div className="text-[10px] text-bad">{r.result.error.message}</div>}
      {r.result.decision ? <JsonView value={prettyJson(r.result.decision)} className="max-h-40" /> : null}
    </div>
  );
}

// ------------------------------------------------------------------- SIMULATION

export function SimPanel() {
  const c = useConfig();
  const patch = usePatch();
  const act = useAction();
  if (!c) return null;
  const s = c.simulation;
  return (
    <>
      <Section title="Simulation loop">
        <Field label="Physics rate">
          <Select<number> value={s.hz} width="w-24" options={[...new Set([...SIM_RATES, s.hz])].map((v) => ({ value: v, label: `${v} Hz` }))} onChange={(v) => patch({ simulation: { hz: v } })} />
        </Field>
        <Field label="Time scale">
          <Select<number> value={s.speed} width="w-24" options={[...new Set([...SIM_SPEEDS, s.speed])].sort((a, b) => a - b).map((v) => ({ value: v, label: v < 1 ? `×${v} slow-mo` : v > 1 ? `×${v} fast` : '×1 realtime' }))} onChange={(v) => patch({ simulation: { speed: v } })} />
        </Field>
        <Field label="Random seed" hint="Applied on reset. Same seed + same inputs = same run.">
          <NumField value={s.seed} step={1} min={0} onCommit={(v) => patch({ simulation: { seed: v } })} />
          <Btn variant="ghost" onClick={() => act(() => api.control('reset'), 'Reset with current seed')}>⟲</Btn>
        </Field>
        <Field label="cmd_vel watchdog"><NumField value={s.cmdVelTimeout} step={0.1} min={0.05} max={10} unit="s" onCommit={(v) => patch({ simulation: { cmdVelTimeout: v } })} /></Field>
      </Section>
      <Section title="Streaming & recording">
        <Field label="UI frame rate"><NumField value={s.uiFrequency} step={5} min={1} max={60} unit="Hz" onCommit={(v) => patch({ simulation: { uiFrequency: v } })} /></Field>
        <Field label="Record rate"><NumField value={s.recordFrequency} step={1} min={1} max={50} unit="Hz" onCommit={(v) => patch({ simulation: { recordFrequency: v } })} /></Field>
        <Field label="Verbose sensor logs"><Toggle checked={s.verboseSensorLogs} onChange={(v) => patch({ simulation: { verboseSensorLogs: v } })} /></Field>
      </Section>
      <Section title="Configuration">
        <Btn className="w-full" onClick={() => act(() => api.resetConfig(), 'Configuration restored to defaults')}>RESTORE DEFAULTS</Btn>
      </Section>
    </>
  );
}

// ------------------------------------------------------------------- FAILURES

export function FailurePanel() {
  const c = useConfig();
  const patch = usePatch();
  if (!c) return null;
  const f = c.failures;
  const motorOpts: Array<{ value: MotorFault; label: string }> = [
    { value: 'none', label: 'OK' },
    { value: 'failure', label: 'FAILURE' },
    { value: 'overheat', label: 'OVERHEAT' },
    { value: 'high_current', label: 'HIGH CURRENT' },
  ];
  const active = [f.lidar, f.gps, f.imu, f.odom, f.leftMotor !== 'none', f.rightMotor !== 'none', f.batteryDrain !== 1, f.aiTimeout, f.aiInvalidResponse, f.aiLatencyMs > 0, f.networkLatencyMs > 0, f.sensorNoiseMultiplier !== 1].filter(Boolean).length;
  return (
    <>
      <div className={cx('mx-3 mt-2 rounded-sm border px-2 py-1 font-mono text-[10px]', active ? 'border-bad/50 bg-bad/10 text-bad' : 'border-line2 text-dim')}>
        FAILURE INJECTION · {active} active
      </div>
      <Section title="Sensors">
        <Field label="LiDAR failure"><Toggle checked={f.lidar} onChange={(v) => patch({ failures: { lidar: v } })} /></Field>
        <Field label="GPS signal loss"><Toggle checked={f.gps} onChange={(v) => patch({ failures: { gps: v } })} /></Field>
        <Field label="IMU failure"><Toggle checked={f.imu} onChange={(v) => patch({ failures: { imu: v } })} /></Field>
        <Field label="Odometry failure"><Toggle checked={f.odom} onChange={(v) => patch({ failures: { odom: v } })} /></Field>
        <Field label="Sensor noise ×"><NumField value={f.sensorNoiseMultiplier} step={0.5} min={0} max={100} onCommit={(v) => patch({ failures: { sensorNoiseMultiplier: v } })} /></Field>
      </Section>
      <Section title="Actuators & power">
        <Field label="Left motor"><Select value={f.leftMotor} width="w-32" options={motorOpts} onChange={(v) => patch({ failures: { leftMotor: v } })} /></Field>
        <Field label="Right motor"><Select value={f.rightMotor} width="w-32" options={motorOpts} onChange={(v) => patch({ failures: { rightMotor: v } })} /></Field>
        <Field label="Battery drain ×"><NumField value={f.batteryDrain} step={1} min={0} max={1000} onCommit={(v) => patch({ failures: { batteryDrain: v } })} /></Field>
      </Section>
      <Section title="AI link">
        <Field label="AI timeout (no answer)"><Toggle checked={f.aiTimeout} onChange={(v) => patch({ failures: { aiTimeout: v } })} /></Field>
        <Field label="AI invalid response"><Toggle checked={f.aiInvalidResponse} onChange={(v) => patch({ failures: { aiInvalidResponse: v } })} /></Field>
        <Field label="AI latency">
          <Select<number> value={f.aiLatencyMs} width="w-24" options={[...new Set([0, 100, 250, 500, 1000, 2000, f.aiLatencyMs])].sort((a, b) => a - b).map((v) => ({ value: v, label: `${v} ms` }))} onChange={(v) => patch({ failures: { aiLatencyMs: v } })} />
        </Field>
        <Field label="Network latency (±30%)">
          <Select<number> value={f.networkLatencyMs} width="w-24" options={[...new Set([0, 50, 100, 250, 500, 1000, f.networkLatencyMs])].sort((a, b) => a - b).map((v) => ({ value: v, label: `${v} ms` }))} onChange={(v) => patch({ failures: { networkLatencyMs: v } })} />
        </Field>
      </Section>
      <Section title="">
        <Btn
          className="w-full"
          onClick={() =>
            patch({
              failures: { lidar: false, gps: false, imu: false, odom: false, leftMotor: 'none', rightMotor: 'none', batteryDrain: 1, aiTimeout: false, aiInvalidResponse: false, aiLatencyMs: 0, networkLatencyMs: 0, sensorNoiseMultiplier: 1 },
            })
          }
        >
          CLEAR ALL FAILURES
        </Btn>
      </Section>
    </>
  );
}
