import type { AiExchange, AppConfig, LogEvent, Scenario, SimFrame } from '@rover/protocol';

export interface RecordedRun {
  scenario: Scenario;
  config: AppConfig;
  seed: number;
  startedAt: number;
  duration: number;
  frames: SimFrame[];
  events: LogEvent[];
  exchanges: AiExchange[];
  truncated: boolean;
  summary: RunSummary;
}

export interface RunSummary {
  duration: number;
  frames: number;
  events: number;
  decisions: number;
  collisions: number;
  missionState: string;
  distanceTravelled: number;
  finalBattery: number;
  provider: string;
}

const MAX_FRAMES = 36_000;
const MAX_EVENTS = 50_000;

/** Collects what is needed to replay a run: periodic telemetry frames, events and AI exchanges. */
export class RunRecorder {
  private frames: SimFrame[] = [];
  private events: LogEvent[] = [];
  private exchanges: AiExchange[] = [];
  private scenario!: Scenario;
  private config!: AppConfig;
  private startedAt = Date.now();
  private nextFrameAt = 0;
  private frameCount = 0;
  truncated = false;
  distance = 0;
  private lastPose: { x: number; y: number } | null = null;

  begin(scenario: Scenario, config: AppConfig): void {
    this.scenario = structuredClone(scenario);
    this.config = structuredClone(config);
    this.frames = [];
    this.events = [];
    this.exchanges = [];
    this.startedAt = Date.now();
    this.nextFrameAt = 0;
    this.frameCount = 0;
    this.truncated = false;
    this.distance = 0;
    this.lastPose = null;
  }

  /** Called every tick; keeps only frames at the record frequency. */
  offerFrame(simTime: number, recordHz: number, build: () => SimFrame): void {
    if (simTime + 1e-9 < this.nextFrameAt) return;
    const period = 1 / Math.max(1, recordHz);
    this.nextFrameAt = this.nextFrameAt + period < simTime ? simTime + period : this.nextFrameAt + period;
    if (this.frames.length >= MAX_FRAMES) {
      this.truncated = true;
      return;
    }
    const f = build();
    if (this.lastPose) this.distance += Math.hypot(f.pose.x - this.lastPose.x, f.pose.y - this.lastPose.y);
    this.lastPose = { x: f.pose.x, y: f.pose.y };
    // Keep LiDAR on every other frame to bound storage.
    if (this.frameCount++ % 2 === 1) f.lidar = null;
    this.frames.push(f);
  }

  addEvent(e: LogEvent): void {
    if (e.level === 'debug') return;
    if (this.events.length >= MAX_EVENTS) {
      this.truncated = true;
      return;
    }
    this.events.push(e);
  }

  addExchange(ex: AiExchange): void {
    if (this.exchanges.length < MAX_EVENTS) this.exchanges.push(ex);
  }

  get frameTotal(): number {
    return this.frames.length;
  }

  get duration(): number {
    return this.frames.length ? this.frames[this.frames.length - 1].simTime : 0;
  }

  snapshot(provider: string): RecordedRun {
    const last = this.frames[this.frames.length - 1];
    return {
      scenario: this.scenario,
      config: this.config,
      seed: this.config.simulation.seed,
      startedAt: this.startedAt,
      duration: this.duration,
      frames: this.frames.slice(),
      events: this.events.slice(),
      exchanges: this.exchanges.slice(),
      truncated: this.truncated,
      summary: {
        duration: this.duration,
        frames: this.frames.length,
        events: this.events.length,
        decisions: this.exchanges.filter((e) => e.decision).length,
        collisions: last?.collisions ?? 0,
        missionState: last?.mission.state ?? 'IDLE',
        distanceTravelled: Math.round(this.distance * 100) / 100,
        finalBattery: last ? Math.round(last.battery.percentage * 10) / 10 : 100,
        provider,
      },
    };
  }
}
