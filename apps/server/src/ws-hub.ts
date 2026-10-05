import type { WebSocket } from 'ws';
import type { ClientMessage, LogEvent, ServerMessage, TopicMessage } from '@rover/protocol';
import { RateMeter } from '@rover/shared';
import type { RoverRuntime } from '@rover/runtime';

interface Client {
  socket: WebSocket;
  topic: string | null;
  topicBuffer: TopicMessage[];
}

const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;

/**
 * Streams runtime data to browsers with per-stream throttling, so the simulation
 * never waits for (or is slowed down by) the UI.
 */
export class WsHub {
  private clients = new Set<Client>();
  private logBuffer: LogEvent[] = [];
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private frameHz = 0;
  private lastFrameTick = -1;
  private lastFrameSent = 0;
  private lastAiId = -1;
  private readonly sentMeter = new RateMeter(2);

  constructor(
    private readonly runtime: RoverRuntime,
    private readonly hello: () => ServerMessage,
  ) {
    runtime.logger.subscribe((e) => {
      if (e.level === 'debug' && !runtime.config.simulation.verboseSensorLogs) return;
      this.logBuffer.push(e);
      if (this.logBuffer.length > 2000) this.logBuffer.splice(0, this.logBuffer.length - 2000);
    });
    runtime.transport.subscribe('*', (msg) => {
      for (const c of this.clients) {
        if (c.topic === msg.topic) {
          c.topicBuffer.push(msg);
          if (c.topicBuffer.length > 50) c.topicBuffer.shift();
        }
      }
    });
    this.timers.push(
      setInterval(() => this.flushLogs(), 100),
      setInterval(() => this.flushTopicMessages(), 100),
      setInterval(() => this.broadcast({ type: 'topics', data: runtime.transport.getTopicInfo() }), 500),
      setInterval(() => this.sendAi(), 250),
      setInterval(() => this.broadcast({ type: 'debug', data: runtime.debugStats({ wsMessageRate: this.messageRate, wsClients: this.clients.size }) }), 1000),
    );
    this.ensureFrameTimer();
  }

  get messageRate(): number {
    return this.sentMeter.rate(performance.now() / 1000);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Re-arms the frame timer when the UI frequency changes. */
  ensureFrameTimer(): void {
    const hz = Math.max(1, Math.min(60, this.runtime.config.simulation.uiFrequency));
    if (hz === this.frameHz && this.frameTimer) return;
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.frameHz = hz;
    this.frameTimer = setInterval(() => this.sendFrame(), 1000 / hz);
  }

  handleConnection(socket: WebSocket): void {
    const client: Client = { socket, topic: null, topicBuffer: [] };
    this.clients.add(client);
    this.send(client, this.hello());
    this.send(client, { type: 'frame', data: this.runtime.buildFrame() });
    this.send(client, { type: 'topics', data: this.runtime.transport.getTopicInfo() });
    this.send(client, { type: 'logs', data: this.runtime.logger.recent(300).filter((e) => e.level !== 'debug') });
    this.send(client, { type: 'ai', data: this.runtime.autonomy.getInspector() });
    this.send(client, { type: 'state', data: this.runtime.autonomy.lastState });

    socket.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        this.send(client, { type: 'error', message: 'invalid JSON' });
        return;
      }
      this.handleMessage(client, msg);
    });
    socket.on('close', () => this.clients.delete(client));
    socket.on('error', () => this.clients.delete(client));
  }

  private handleMessage(client: Client, msg: ClientMessage): void {
    switch (msg.type) {
      case 'manual':
        this.runtime.autonomy.setManual(Number(msg.throttle), Number(msg.steering));
        break;
      case 'subscribe_topic': {
        client.topic = typeof msg.topic === 'string' ? msg.topic : null;
        client.topicBuffer = [];
        const last = client.topic ? this.runtime.transport.getLastMessage(client.topic) : undefined;
        if (client.topic && last) this.send(client, { type: 'topic_messages', topic: client.topic, data: [last] });
        break;
      }
      case 'ping':
        break;
      default:
        this.send(client, { type: 'error', message: 'unknown message type' });
    }
  }

  broadcast(msg: ServerMessage): void {
    if (this.clients.size === 0) return;
    const payload = JSON.stringify(msg);
    for (const c of this.clients) this.sendRaw(c, payload, msg.type === 'frame');
  }

  private send(c: Client, msg: ServerMessage): void {
    this.sendRaw(c, JSON.stringify(msg), false);
  }

  private sendRaw(c: Client, payload: string, droppable: boolean): void {
    if (c.socket.readyState !== c.socket.OPEN) return;
    // Slow client: drop droppable traffic instead of queueing unbounded data.
    if (droppable && c.socket.bufferedAmount > MAX_BUFFERED_BYTES) return;
    try {
      c.socket.send(payload);
      this.sentMeter.mark(performance.now() / 1000);
    } catch {
      this.clients.delete(c);
    }
  }

  private sendFrame(): void {
    const tick = this.runtime.sim.tick;
    const now = Date.now();
    // Skip identical frames while paused, but keep a 1 Hz heartbeat.
    if (tick === this.lastFrameTick && now - this.lastFrameSent < 1000) return;
    this.lastFrameTick = tick;
    this.lastFrameSent = now;
    this.broadcast({ type: 'frame', data: this.runtime.buildFrame() });
  }

  private flushLogs(): void {
    if (this.logBuffer.length === 0) return;
    const batch = this.logBuffer.splice(0, 500);
    this.broadcast({ type: 'logs', data: batch });
  }

  private flushTopicMessages(): void {
    for (const c of this.clients) {
      if (c.topic && c.topicBuffer.length > 0) {
        const data = c.topicBuffer.splice(0, c.topicBuffer.length).slice(-10);
        this.sendRaw(c, JSON.stringify({ type: 'topic_messages', topic: c.topic, data } satisfies ServerMessage), true);
      }
    }
  }

  private sendAi(): void {
    const inspector = this.runtime.autonomy.getInspector();
    const id = inspector.lastExchange?.id ?? -1;
    this.broadcast({ type: 'state', data: this.runtime.autonomy.lastState });
    if (id !== this.lastAiId || this.runtime.status !== 'RUNNING') {
      this.lastAiId = id;
      this.broadcast({ type: 'ai', data: inspector });
    }
  }

  close(): void {
    for (const t of this.timers) clearInterval(t);
    if (this.frameTimer) clearInterval(this.frameTimer);
    for (const c of this.clients) c.socket.close();
    this.clients.clear();
  }
}
