import type { ClientMessage, ServerMessage } from '@rover/protocol';
import { useStore } from '../store';
import { pushLiveFrame, resetLive } from './live';

let socket: WebSocket | null = null;
let retry = 0;
let lastReactFrame = 0;
const MAX_LOGS = 3000;

export function send(msg: ClientMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

export function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  socket = ws;
  ws.onopen = () => {
    retry = 0;
    useStore.getState().set({ connected: true });
    const topic = useStore.getState().selectedTopic;
    if (topic) send({ type: 'subscribe_topic', topic });
  };
  ws.onclose = () => {
    useStore.getState().set({ connected: false });
    socket = null;
    // Exponential backoff; the simulation keeps running server-side meanwhile.
    const delay = Math.min(5000, 300 * 2 ** retry++);
    setTimeout(connect, delay);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (ev) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(ev.data as string) as ServerMessage;
    } catch {
      return;
    }
    handle(msg);
  };
}

function handle(msg: ServerMessage): void {
  const st = useStore.getState();
  switch (msg.type) {
    case 'hello': {
      const d = msg.data;
      resetLive();
      st.set({ config: d.config, scenario: d.scenario, status: d.status, mode: d.mode, devMode: d.devMode, recording: d.recording, version: d.version, logs: [] });
      break;
    }
    case 'frame': {
      pushLiveFrame(msg.data);
      const now = performance.now();
      const f = msg.data;
      const patch: Partial<ReturnType<typeof useStore.getState>> = {};
      if (f.status !== st.status) patch.status = f.status;
      if (f.mode !== st.mode) patch.mode = f.mode;
      if (f.devMode !== st.devMode) patch.devMode = f.devMode;
      if (now - lastReactFrame > 125 || Object.keys(patch).length) {
        lastReactFrame = now;
        patch.frame = f;
      }
      if (Object.keys(patch).length) st.set(patch);
      break;
    }
    case 'logs': {
      const logs = st.logs.concat(msg.data);
      st.set({ logs: logs.length > MAX_LOGS ? logs.slice(logs.length - MAX_LOGS) : logs });
      break;
    }
    case 'topics':
      st.set({ topics: msg.data });
      break;
    case 'topic_messages':
      if (msg.topic === st.selectedTopic) {
        const all = st.topicMessages.concat(msg.data);
        st.set({ topicMessages: all.length > 200 ? all.slice(all.length - 200) : all });
      }
      break;
    case 'state':
      st.set({ aggState: msg.data });
      break;
    case 'ai':
      st.set({ ai: msg.data });
      break;
    case 'config':
      st.set({ config: msg.data });
      break;
    case 'scenario':
      resetLive();
      st.set({ scenario: msg.data });
      break;
    case 'status':
      st.set({ status: msg.data.status, mode: msg.data.mode, devMode: msg.data.devMode, recording: msg.data.recording });
      break;
    case 'debug':
      st.set({ debug: msg.data });
      break;
    case 'error':
      st.toast(msg.message, 'error');
      break;
  }
}

export function subscribeTopic(topic: string | null): void {
  useStore.getState().set({ selectedTopic: topic, topicMessages: [] });
  send({ type: 'subscribe_topic', topic });
}
