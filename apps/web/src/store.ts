import { create } from 'zustand';
import type {
  AggregatedState,
  AiInspectorData,
  AppConfig,
  ControlMode,
  DebugStats,
  DevMode,
  LogEvent,
  Scenario,
  SimFrame,
  SimStatus,
  TopicInfo,
  TopicMessage,
} from '@rover/protocol';
import type { RunDetail } from './lib/api';

export type EditorTool = 'none' | 'select' | 'rect' | 'circle' | 'target' | 'waypoint' | 'rover' | 'delete';
export type LeftTab = 'scenario' | 'robot' | 'sensors' | 'ai' | 'sim' | 'faults';
export type BottomTab = 'topics' | 'logs' | 'inspector' | 'state' | 'runs' | 'debug';

export interface Layers {
  grid: boolean;
  lidar: boolean;
  trail: boolean;
  odom: boolean;
  safety: boolean;
  follow: boolean;
}

export interface ReplayState {
  run: RunDetail;
  index: number;
  playing: boolean;
  speed: number;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

interface AppStore {
  connected: boolean;
  version: string;
  config: AppConfig | null;
  scenario: Scenario | null;
  status: SimStatus;
  mode: ControlMode;
  devMode: DevMode;
  recording: { active: boolean; frames: number; duration: number };
  /** Throttled copy of the live frame for React panels (~8 Hz). */
  frame: SimFrame | null;
  topics: TopicInfo[];
  logs: LogEvent[];
  ai: AiInspectorData | null;
  aggState: AggregatedState | null;
  debug: DebugStats | null;
  selectedTopic: string | null;
  topicMessages: TopicMessage[];
  leftTab: LeftTab;
  bottomTab: BottomTab;
  tool: EditorTool;
  selectedObstacle: string | null;
  draft: Scenario | null;
  layers: Layers;
  debugMode: boolean;
  replay: ReplayState | null;
  toasts: Toast[];
  renderFps: number;
  set: (partial: Partial<AppStore>) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
}

let toastId = 0;

export const useStore = create<AppStore>((set, get) => ({
  connected: false,
  version: '',
  config: null,
  scenario: null,
  status: 'PAUSED',
  mode: 'MANUAL',
  devMode: 'SIMULATION',
  recording: { active: false, frames: 0, duration: 0 },
  frame: null,
  topics: [],
  logs: [],
  ai: null,
  aggState: null,
  debug: null,
  selectedTopic: null,
  topicMessages: [],
  leftTab: 'scenario',
  bottomTab: 'topics',
  tool: 'none',
  selectedObstacle: null,
  draft: null,
  layers: { grid: true, lidar: true, trail: true, odom: false, safety: true, follow: false },
  debugMode: false,
  replay: null,
  toasts: [],
  renderFps: 0,
  set: (partial) => set(partial),
  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'error' ? 6000 : 3000);
  },
}));

/** The scenario shown on the map: replay > draft (editing) > live. */
export function displayScenario(s: AppStore): Scenario | null {
  return s.replay?.run.scenario ?? s.draft ?? s.scenario;
}
