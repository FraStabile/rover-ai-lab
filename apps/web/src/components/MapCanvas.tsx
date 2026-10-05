import { useEffect, useRef, useState } from 'react';
import type { AppConfig, Obstacle, Scenario, SimFrame } from '@rover/protocol';
import { api } from '../lib/api';
import { live } from '../lib/live';
import { displayScenario, useStore, type EditorTool } from '../store';
import { cx } from './ui';

interface View {
  scale: number;
  ox: number;
  oy: number;
  fitted: boolean;
}

interface Drag {
  kind: 'pan' | 'move-obstacle' | 'move-rover' | 'move-target' | 'move-waypoint' | 'new-rect' | 'new-circle' | 'rover-heading';
  startX: number;
  startY: number;
  wx: number;
  wy: number;
  id?: string;
  index?: number;
  orig?: { x: number; y: number };
  view?: View;
}

const C = {
  bg: '#080b10',
  gridMinor: 'rgba(120,150,180,0.06)',
  gridMajor: 'rgba(120,150,180,0.14)',
  axis: 'rgba(120,150,180,0.45)',
  wall: '#3b4a5e',
  obstacleFill: 'rgba(71,85,105,0.55)',
  obstacleStroke: '#64748b',
  obstacleSel: '#22d3ee',
  lidarRay: 'rgba(34,211,238,0.10)',
  lidarHit: '#f5a524',
  lidarNear: '#f43f5e',
  trail: 'rgba(56,189,248,0.75)',
  odom: 'rgba(167,139,250,0.7)',
  target: '#34d399',
  waypoint: '#a78bfa',
  body: '#1c2633',
  bodyStroke: '#22d3ee',
  front: '#f5a524',
  wheel: '#05070a',
};

export function MapCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ scale: 20, ox: 0, oy: 0, fitted: true });
  const drag = useRef<Drag | null>(null);
  const preview = useRef<Obstacle | null>(null);
  const cursor = useRef<{ x: number; y: number } | null>(null);
  const [cursorText, setCursorText] = useState('');
  const tool = useStore((s) => s.tool);

  // --------------------------------------------------------------- render loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let frames = 0;
    let fpsT = performance.now();
    let lastW = 0;
    let lastH = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const wrap = wrapRef.current;
      if (!wrap) return;
      const dpr = window.devicePixelRatio || 1;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w !== lastW || h !== lastH) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        lastW = w;
        lastH = h;
      }
      const st = useStore.getState();
      const scenario = displayScenario(st);
      const cfg = st.replay?.run.config ?? st.config;
      const frame = st.replay ? st.replay.run.frames[st.replay.index] ?? null : live.frame;
      if (scenario && view.current.fitted) fit(view.current, scenario, w, h);
      if (scenario && st.layers.follow && frame && !drag.current) {
        const v = view.current;
        v.ox = w / 2 - frame.pose.x * v.scale;
        v.oy = h / 2 + frame.pose.y * v.scale;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, w, h, view.current, scenario, cfg, frame, st, preview.current);
      frames++;
      const now = performance.now();
      if (now - fpsT > 1000) {
        useStore.getState().set({ renderFps: Math.round((frames * 1000) / (now - fpsT)) });
        frames = 0;
        fpsT = now;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // --------------------------------------------------------------- interactions
  const toWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const v = view.current;
    return { x: (clientX - rect.left - v.ox) / v.scale, y: (v.oy - (clientY - rect.top)) / v.scale };
  };

  const ensureDraft = (): Scenario | null => {
    const st = useStore.getState();
    if (st.replay) return null;
    if (st.draft) return st.draft;
    if (!st.scenario) return null;
    const d = structuredClone(st.scenario);
    st.set({ draft: d });
    return d;
  };

  const updateDraft = (fn: (s: Scenario) => void) => {
    const d = ensureDraft();
    if (!d) return;
    const next = structuredClone(d);
    fn(next);
    useStore.getState().set({ draft: next });
  };

  const commitDraft = async () => {
    const st = useStore.getState();
    if (!st.draft) return;
    try {
      const s = await api.loadScenario({ ...st.draft, builtIn: false });
      useStore.getState().set({ scenario: s, draft: null });
    } catch (err) {
      st.toast(`Scenario rejected: ${(err as Error).message}`, 'error');
      useStore.getState().set({ draft: null });
    }
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const st = useStore.getState();
    const p = toWorld(e.clientX, e.clientY);
    const t: EditorTool = st.replay ? 'none' : st.tool;
    const base = { startX: e.clientX, startY: e.clientY, wx: p.x, wy: p.y };
    if (e.button === 1 || e.button === 2 || t === 'none' || e.shiftKey) {
      drag.current = { kind: 'pan', ...base, view: { ...view.current } };
      return;
    }
    const s = displayScenario(st);
    if (!s) return;
    switch (t) {
      case 'select': {
        if (s.target && Math.hypot(p.x - s.target.x, p.y - s.target.y) < 0.7) {
          drag.current = { kind: 'move-target', ...base, orig: { ...s.target } };
          return;
        }
        const wi = s.waypoints.findIndex((w) => Math.hypot(p.x - w.x, p.y - w.y) < 0.6);
        if (wi >= 0) {
          drag.current = { kind: 'move-waypoint', ...base, index: wi, orig: { ...s.waypoints[wi] } };
          return;
        }
        if (Math.hypot(p.x - s.rover.x, p.y - s.rover.y) < 0.6) {
          drag.current = { kind: 'move-rover', ...base, orig: { x: s.rover.x, y: s.rover.y } };
          return;
        }
        const hit = hitObstacle(s.obstacles, p.x, p.y);
        st.set({ selectedObstacle: hit?.id ?? null });
        if (hit) drag.current = { kind: 'move-obstacle', ...base, id: hit.id, orig: { x: hit.x, y: hit.y } };
        else drag.current = { kind: 'pan', ...base, view: { ...view.current } };
        return;
      }
      case 'rect':
        drag.current = { kind: 'new-rect', ...base };
        preview.current = { id: 'preview', kind: 'rect', x: p.x, y: p.y, w: 0.01, h: 0.01 };
        return;
      case 'circle':
        drag.current = { kind: 'new-circle', ...base };
        preview.current = { id: 'preview', kind: 'circle', x: p.x, y: p.y, r: 0.01 };
        return;
      case 'target':
        updateDraft((d) => (d.target = { x: r2(p.x), y: r2(p.y) }));
        void commitDraft();
        return;
      case 'waypoint':
        updateDraft((d) => d.waypoints.push({ x: r2(p.x), y: r2(p.y) }));
        void commitDraft();
        return;
      case 'rover':
        updateDraft((d) => (d.rover = { ...d.rover, x: r2(p.x), y: r2(p.y) }));
        drag.current = { kind: 'rover-heading', ...base };
        return;
      case 'delete': {
        const wi = s.waypoints.findIndex((w) => Math.hypot(p.x - w.x, p.y - w.y) < 0.6);
        if (wi >= 0) {
          updateDraft((d) => d.waypoints.splice(wi, 1));
          void commitDraft();
          return;
        }
        if (s.target && Math.hypot(p.x - s.target.x, p.y - s.target.y) < 0.6) {
          updateDraft((d) => (d.target = null));
          void commitDraft();
          return;
        }
        const hit = hitObstacle(s.obstacles, p.x, p.y);
        if (hit) {
          updateDraft((d) => (d.obstacles = d.obstacles.filter((o) => o.id !== hit.id)));
          void commitDraft();
        }
        return;
      }
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const p = toWorld(e.clientX, e.clientY);
    cursor.current = p;
    setCursorText(`${p.x.toFixed(2)}, ${p.y.toFixed(2)} m`);
    const d = drag.current;
    if (!d) return;
    const dx = p.x - d.wx;
    const dy = p.y - d.wy;
    switch (d.kind) {
      case 'pan': {
        const v = view.current;
        v.fitted = false;
        const { layers, set } = useStore.getState();
        if (layers.follow) set({ layers: { ...layers, follow: false } });
        v.ox = d.view!.ox + (e.clientX - d.startX);
        v.oy = d.view!.oy + (e.clientY - d.startY);
        break;
      }
      case 'move-obstacle':
        updateDraft((s) => {
          const o = s.obstacles.find((x) => x.id === d.id);
          if (o) {
            o.x = r2(d.orig!.x + dx);
            o.y = r2(d.orig!.y + dy);
          }
        });
        break;
      case 'move-target':
        updateDraft((s) => (s.target = { x: r2(d.orig!.x + dx), y: r2(d.orig!.y + dy) }));
        break;
      case 'move-waypoint':
        updateDraft((s) => (s.waypoints[d.index!] = { x: r2(d.orig!.x + dx), y: r2(d.orig!.y + dy) }));
        break;
      case 'move-rover':
        updateDraft((s) => (s.rover = { ...s.rover, x: r2(d.orig!.x + dx), y: r2(d.orig!.y + dy) }));
        break;
      case 'rover-heading':
        if (Math.hypot(dx, dy) > 0.2) updateDraft((s) => (s.rover = { ...s.rover, heading: Math.round((Math.atan2(dy, dx) * 180) / Math.PI) }));
        break;
      case 'new-rect':
        preview.current = { id: 'preview', kind: 'rect', x: (d.wx + p.x) / 2, y: (d.wy + p.y) / 2, w: Math.abs(dx), h: Math.abs(dy) };
        break;
      case 'new-circle':
        preview.current = { id: 'preview', kind: 'circle', x: d.wx, y: d.wy, r: Math.hypot(dx, dy) };
        break;
    }
  };

  const onMouseUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'new-rect' || d.kind === 'new-circle') {
      const o = preview.current;
      preview.current = null;
      if (!o) return;
      const big = o.kind === 'rect' ? o.w > 0.15 && o.h > 0.15 : o.r > 0.1;
      if (!big) return;
      const id = `${o.kind === 'rect' ? 'r' : 'c'}${Date.now().toString(36)}`;
      const rounded: Obstacle = o.kind === 'rect' ? { ...o, id, x: r2(o.x), y: r2(o.y), w: r2(o.w), h: r2(o.h) } : { ...o, id, x: r2(o.x), y: r2(o.y), r: r2(o.r) };
      updateDraft((s) => s.obstacles.push(rounded));
      useStore.getState().set({ selectedObstacle: id });
      void commitDraft();
      return;
    }
    if (d.kind !== 'pan') void commitDraft();
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const v = view.current;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const ns = Math.max(2, Math.min(400, v.scale * factor));
    v.ox = mx - ((mx - v.ox) / v.scale) * ns;
    v.oy = my - ((my - v.oy) / v.scale) * ns;
    v.scale = ns;
    v.fitted = false;
  };

  const cursorCls = tool === 'none' ? 'cursor-grab' : tool === 'delete' ? 'cursor-not-allowed' : tool === 'select' ? 'cursor-default' : 'cursor-crosshair';

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-[#080b10]">
      <canvas
        ref={canvasRef}
        className={cx('absolute inset-0', cursorCls)}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          onMouseUp();
          cursor.current = null;
          setCursorText('');
        }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={() => (view.current.fitted = true)}
      />
      <div className="pointer-events-none absolute bottom-2 right-2 rounded-sm bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-dim">{cursorText || 'scroll: zoom · drag: pan · dbl-click: fit'}</div>
    </div>
  );
}

// ------------------------------------------------------------------- helpers

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

function fit(v: View, s: Scenario, w: number, h: number): void {
  const m = 24;
  const scale = Math.max(2, Math.min((w - m * 2) / s.world.width, (h - m * 2) / s.world.height));
  v.scale = scale;
  v.ox = (w - s.world.width * scale) / 2;
  v.oy = h - (h - s.world.height * scale) / 2;
}

function hitObstacle(obs: Obstacle[], x: number, y: number): Obstacle | null {
  for (let i = obs.length - 1; i >= 0; i--) {
    const o = obs[i];
    if (o.kind === 'circle' ? Math.hypot(x - o.x, y - o.y) <= o.r : Math.abs(x - o.x) <= o.w / 2 && Math.abs(y - o.y) <= o.h / 2) return o;
  }
  return null;
}

type StoreState = ReturnType<typeof useStore.getState>;

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  v: View,
  s: Scenario | null,
  cfg: AppConfig | null,
  f: SimFrame | null,
  st: StoreState,
  preview: Obstacle | null,
): void {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  if (!s) return;
  const X = (x: number) => v.ox + x * v.scale;
  const Y = (y: number) => v.oy - y * v.scale;
  const W = s.world.width;
  const H = s.world.height;

  // World floor
  ctx.fillStyle = '#0b1017';
  ctx.fillRect(X(0), Y(H), W * v.scale, H * v.scale);

  if (st.layers.grid) drawGrid(ctx, v, W, H, X, Y);

  // Walls
  ctx.strokeStyle = C.wall;
  ctx.lineWidth = 3;
  ctx.strokeRect(X(0), Y(H), W * v.scale, H * v.scale);

  // Planned route (start → waypoints → target)
  const route = [{ x: s.rover.x, y: s.rover.y }, ...s.waypoints, ...(s.target ? [s.target] : [])];
  if (route.length > 1) {
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(167,139,250,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    route.forEach((p, i) => (i === 0 ? ctx.moveTo(X(p.x), Y(p.y)) : ctx.lineTo(X(p.x), Y(p.y))));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Obstacles
  for (const o of s.obstacles) drawObstacle(ctx, o, X, Y, v.scale, o.id === st.selectedObstacle && st.tool !== 'none');
  if (preview) drawObstacle(ctx, preview, X, Y, v.scale, true, true);

  // Home
  ctx.strokeStyle = 'rgba(200,211,223,0.5)';
  ctx.lineWidth = 1;
  const hs = Math.max(5, 0.35 * v.scale);
  ctx.strokeRect(X(s.rover.x) - hs, Y(s.rover.y) - hs, hs * 2, hs * 2);
  label(ctx, 'HOME', X(s.rover.x) + hs + 3, Y(s.rover.y) - hs, 'rgba(200,211,223,0.5)');

  // Waypoints
  const goalIndex = f?.mission.goalIndex ?? 0;
  s.waypoints.forEach((p, i) => {
    const done = i < goalIndex;
    ctx.beginPath();
    ctx.arc(X(p.x), Y(p.y), Math.max(6, 0.35 * v.scale), 0, Math.PI * 2);
    ctx.fillStyle = done ? 'rgba(167,139,250,0.15)' : 'rgba(167,139,250,0.25)';
    ctx.fill();
    ctx.strokeStyle = C.waypoint;
    ctx.lineWidth = i === goalIndex ? 2 : 1;
    ctx.stroke();
    ctx.fillStyle = done ? 'rgba(167,139,250,0.6)' : '#e9e3ff';
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), X(p.x), Y(p.y));
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  });

  // Target
  if (s.target) {
    const tx = X(s.target.x);
    const ty = Y(s.target.y);
    const tol = s.mission.tolerance * v.scale;
    ctx.beginPath();
    ctx.arc(tx, ty, Math.max(4, tol), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(52,211,153,0.12)';
    ctx.fill();
    ctx.strokeStyle = C.target;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const r = Math.max(8, tol + 6);
    ctx.beginPath();
    ctx.moveTo(tx - r, ty);
    ctx.lineTo(tx + r, ty);
    ctx.moveTo(tx, ty - r);
    ctx.lineTo(tx, ty + r);
    ctx.stroke();
    label(ctx, 'TARGET', tx + r + 3, ty - 4, C.target);
  }

  // Trail
  const trail = st.replay ? st.replay.run.frames.slice(0, st.replay.index + 1).map((fr) => fr.pose) : live.trail;
  if (st.layers.trail && trail.length > 1) drawPath(ctx, trail, X, Y, C.trail, 1.6);
  if (st.layers.odom) {
    const ot = st.replay ? st.replay.run.frames.slice(0, st.replay.index + 1).map((fr) => fr.odomPose) : live.odomTrail;
    if (ot.length > 1) {
      ctx.setLineDash([3, 3]);
      drawPath(ctx, ot, X, Y, C.odom, 1);
      ctx.setLineDash([]);
    }
  }

  if (!f) {
    drawRover(ctx, X(s.rover.x), Y(s.rover.y), (s.rover.heading * Math.PI) / 180, cfg, v.scale, false, false);
    return;
  }

  // LiDAR
  if (st.layers.lidar && f.lidar) drawLidar(ctx, f, X, Y, v.scale);

  // Safety envelope
  if (st.layers.safety && cfg) drawSafety(ctx, f, cfg, X, Y, v.scale);

  // Odometry ghost
  if (st.layers.odom) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    drawRover(ctx, X(f.odomPose.x), Y(f.odomPose.y), f.odomPose.heading, cfg, v.scale, false, false, true);
    ctx.restore();
  }

  drawRover(ctx, X(f.pose.x), Y(f.pose.y), f.pose.heading, cfg, v.scale, f.collision, f.estop || f.safety?.action === 'EMERGENCY_STOP');

  // cmd_vel vector
  if (Math.abs(f.cmdVel.linear) > 0.01) {
    const len = f.cmdVel.linear * v.scale;
    const hx = Math.cos(f.pose.heading);
    const hy = Math.sin(f.pose.heading);
    ctx.strokeStyle = '#f5a524';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X(f.pose.x), Y(f.pose.y));
    ctx.lineTo(X(f.pose.x) + hx * len, Y(f.pose.y) - hy * len);
    ctx.stroke();
  }
  if (Math.abs(f.cmdVel.angular) > 0.02) {
    const r = Math.max(14, 0.6 * v.scale);
    const a0 = -f.pose.heading;
    const sweep = -f.cmdVel.angular * 0.8;
    ctx.strokeStyle = 'rgba(245,165,36,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(X(f.pose.x), Y(f.pose.y), r, Math.min(a0, a0 + sweep), Math.max(a0, a0 + sweep));
    ctx.stroke();
  }
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.font = '600 9px ui-monospace, monospace';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawGrid(ctx: CanvasRenderingContext2D, v: View, W: number, H: number, X: (x: number) => number, Y: (y: number) => number): void {
  const minorStep = v.scale > 14 ? 1 : v.scale > 5 ? 5 : 10;
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += minorStep) {
    ctx.strokeStyle = x % 5 === 0 ? C.gridMajor : C.gridMinor;
    ctx.beginPath();
    ctx.moveTo(Math.round(X(x)) + 0.5, Y(0));
    ctx.lineTo(Math.round(X(x)) + 0.5, Y(H));
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += minorStep) {
    ctx.strokeStyle = y % 5 === 0 ? C.gridMajor : C.gridMinor;
    ctx.beginPath();
    ctx.moveTo(X(0), Math.round(Y(y)) + 0.5);
    ctx.lineTo(X(W), Math.round(Y(y)) + 0.5);
    ctx.stroke();
  }
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillStyle = C.axis;
  const labelStep = v.scale > 14 ? 5 : 10;
  for (let x = 0; x <= W; x += labelStep) ctx.fillText(`${x}`, X(x) + 2, Y(0) + 11);
  for (let y = labelStep; y <= H; y += labelStep) ctx.fillText(`${y}`, X(0) - 16, Y(y) + 3);
  // Axis gizmo at origin
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#f43f5e';
  ctx.beginPath();
  ctx.moveTo(X(0), Y(0));
  ctx.lineTo(X(0) + 26, Y(0));
  ctx.stroke();
  ctx.strokeStyle = '#34d399';
  ctx.beginPath();
  ctx.moveTo(X(0), Y(0));
  ctx.lineTo(X(0), Y(0) - 26);
  ctx.stroke();
}

function drawObstacle(ctx: CanvasRenderingContext2D, o: Obstacle, X: (x: number) => number, Y: (y: number) => number, scale: number, selected: boolean, ghost = false): void {
  ctx.fillStyle = ghost ? 'rgba(34,211,238,0.15)' : C.obstacleFill;
  ctx.strokeStyle = selected ? C.obstacleSel : C.obstacleStroke;
  ctx.lineWidth = selected ? 2 : 1;
  ctx.beginPath();
  if (o.kind === 'rect') ctx.rect(X(o.x - o.w / 2), Y(o.y + o.h / 2), o.w * scale, o.h * scale);
  else ctx.arc(X(o.x), Y(o.y), o.r * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Hatching
  if (!ghost && scale > 6) {
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(148,163,184,0.12)';
    ctx.lineWidth = 1;
    const ext = o.kind === 'rect' ? Math.max(o.w, o.h) : o.r * 2;
    const cx = X(o.x);
    const cy = Y(o.y);
    const span = ext * scale;
    for (let d = -span; d < span; d += 6) {
      ctx.beginPath();
      ctx.moveTo(cx + d - span, cy + span);
      ctx.lineTo(cx + d + span, cy - span);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawPath(ctx: CanvasRenderingContext2D, pts: Array<{ x: number; y: number }>, X: (x: number) => number, Y: (y: number) => number, color: string, width: number): void {
  const step = Math.max(1, Math.floor(pts.length / 3000));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i];
    if (i === 0) ctx.moveTo(X(p.x), Y(p.y));
    else ctx.lineTo(X(p.x), Y(p.y));
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(X(last.x), Y(last.y));
  ctx.stroke();
}

function drawLidar(ctx: CanvasRenderingContext2D, f: SimFrame, X: (x: number) => number, Y: (y: number) => number, scale: number): void {
  const l = f.lidar!;
  const px = X(f.pose.x);
  const py = Y(f.pose.y);
  const n = l.ranges.length;
  // FOV wedge
  const a0 = f.pose.heading + l.angleMin;
  const a1 = f.pose.heading + l.angleMin + l.angleIncrement * (n - 1);
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.arc(px, py, l.rangeMax * scale, -a1, -a0);
  ctx.closePath();
  ctx.fillStyle = 'rgba(34,211,238,0.035)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(34,211,238,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Rays
  ctx.strokeStyle = C.lidarRay;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = f.pose.heading + l.angleMin + i * l.angleIncrement;
    const r = l.ranges[i];
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(a) * r * scale, py - Math.sin(a) * r * scale);
  }
  ctx.stroke();
  // Returns
  for (let i = 0; i < n; i++) {
    const r = l.ranges[i];
    if (r >= l.rangeMax - 1e-3) continue;
    const a = f.pose.heading + l.angleMin + i * l.angleIncrement;
    ctx.fillStyle = r < 1 ? C.lidarNear : C.lidarHit;
    ctx.fillRect(px + Math.cos(a) * r * scale - 1.5, py - Math.sin(a) * r * scale - 1.5, 3, 3);
  }
}

function drawSafety(ctx: CanvasRenderingContext2D, f: SimFrame, cfg: AppConfig, X: (x: number) => number, Y: (y: number) => number, scale: number): void {
  const L = cfg.robot.length;
  const Wd = cfg.robot.width;
  const active = f.safety && f.safety.verdict !== 'ALLOW';
  ctx.save();
  ctx.translate(X(f.pose.x), Y(f.pose.y));
  ctx.rotate(-f.pose.heading);
  const zone = (depth: number, color: string, fill: string) => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = color;
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect((L / 2) * scale, (-Wd / 2) * scale, depth * scale, Wd * scale);
    ctx.fill();
    ctx.stroke();
  };
  zone(cfg.safety.slowDownDistance, 'rgba(245,165,36,0.35)', 'rgba(245,165,36,0.03)');
  zone(cfg.safety.emergencyStopDistance, active ? 'rgba(244,63,94,0.9)' : 'rgba(244,63,94,0.4)', active ? 'rgba(244,63,94,0.18)' : 'rgba(244,63,94,0.05)');
  ctx.restore();
  ctx.setLineDash([]);
}

function drawRover(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  cfg: AppConfig | null,
  scale: number,
  collision: boolean,
  estop: boolean,
  ghost = false,
): void {
  const L = (cfg?.robot.length ?? 0.7) * scale;
  const Wd = (cfg?.robot.width ?? 0.5) * scale;
  const minPx = 10;
  const k = Math.max(1, minPx / Math.min(L, Wd));
  const l = L * k;
  const wd = Wd * k;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-heading);
  // Wheels (skid-steer, 4 wheels)
  const ww = l * 0.28;
  const wh = wd * 0.22;
  ctx.fillStyle = ghost ? 'rgba(167,139,250,0.5)' : C.wheel;
  ctx.strokeStyle = ghost ? C.odom : '#334155';
  ctx.lineWidth = 1;
  for (const [sx, sy] of [
    [l * 0.28, wd / 2],
    [-l * 0.28, wd / 2],
    [l * 0.28, -wd / 2],
    [-l * 0.28, -wd / 2],
  ]) {
    ctx.beginPath();
    ctx.rect(sx - ww / 2, sy - wh / 2, ww, wh);
    ctx.fill();
    ctx.stroke();
  }
  // Chassis
  ctx.fillStyle = ghost ? 'rgba(167,139,250,0.15)' : collision ? 'rgba(244,63,94,0.35)' : C.body;
  ctx.strokeStyle = ghost ? C.odom : collision || estop ? '#f43f5e' : C.bodyStroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-l / 2, -wd * 0.38, l, wd * 0.76, 2);
  ctx.fill();
  ctx.stroke();
  if (!ghost) {
    // Rear marker
    ctx.fillStyle = '#475569';
    ctx.fillRect(-l / 2 + 1, -wd * 0.3, 2, wd * 0.6);
    // Front bumper + chevron
    ctx.fillStyle = C.front;
    ctx.fillRect(l / 2 - 3, -wd * 0.38, 3, wd * 0.76);
    ctx.strokeStyle = C.front;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-l * 0.05, -wd * 0.2);
    ctx.lineTo(l * 0.25, 0);
    ctx.lineTo(-l * 0.05, wd * 0.2);
    ctx.stroke();
    // LiDAR puck
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(2, wd * 0.09), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
