import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { Btn, cx } from './ui';

const SPEEDS = [0.5, 1, 2, 5, 10];

function indexAt(frames: Array<{ simTime: number }>, t: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].simTime <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Client-side playback of a recorded run (timeline, play/pause, step, speed). */
export function ReplayBar() {
  const replay = useStore((s) => s.replay);
  const set = useStore((s) => s.set);
  const time = useRef(0);

  useEffect(() => {
    if (!replay?.playing) return;
    let last = performance.now();
    const start = useStore.getState().replay;
    time.current = start ? (start.run.frames[start.index]?.simTime ?? 0) : 0;
    const id = setInterval(() => {
      const r = useStore.getState().replay;
      if (!r) return;
      const now = performance.now();
      time.current += ((now - last) / 1000) * r.speed;
      last = now;
      const frames = r.run.frames;
      const end = frames[frames.length - 1].simTime;
      if (time.current >= end) {
        set({ replay: { ...r, index: frames.length - 1, playing: false } });
        return;
      }
      const index = indexAt(frames, time.current);
      if (index !== r.index) set({ replay: { ...r, index } });
    }, 33);
    return () => clearInterval(id);
  }, [replay?.playing, replay?.speed, replay?.run, set]);

  if (!replay) return null;
  const frames = replay.run.frames;
  const f = frames[replay.index];
  const duration = frames[frames.length - 1]?.simTime ?? 0;
  const update = (patch: Partial<typeof replay>) => set({ replay: { ...replay, ...patch } });

  return (
    <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-sm border border-warn/40 bg-panel/95 px-2 py-1.5 backdrop-blur">
      <span className="font-mono text-[10px] font-bold text-warn">REPLAY</span>
      <Btn onClick={() => update({ index: Math.max(0, replay.index - 1), playing: false })}>◀▮</Btn>
      {replay.playing ? <Btn variant="warn" onClick={() => update({ playing: false })}>❚❚</Btn> : <Btn variant="ok" onClick={() => update({ playing: true, index: replay.index >= frames.length - 1 ? 0 : replay.index })}>▶</Btn>}
      <Btn onClick={() => update({ index: Math.min(frames.length - 1, replay.index + 1), playing: false })}>▮▶</Btn>
      <span className="num w-14 text-right text-[11px] text-white">{f?.simTime.toFixed(1)}s</span>
      <input
        type="range"
        className="flex-1"
        min={0}
        max={duration}
        step={0.01}
        value={f?.simTime ?? 0}
        onChange={(e) => update({ index: indexAt(frames, Number(e.target.value)) })}
      />
      <span className="num w-14 text-[11px] text-dim">{duration.toFixed(1)}s</span>
      <div className="flex gap-0.5">
        {SPEEDS.map((s) => (
          <button key={s} type="button" onClick={() => update({ speed: s })} className={cx('h-5 rounded-sm border px-1 font-mono text-[10px]', replay.speed === s ? 'border-warn text-warn' : 'border-line2 text-dim')}>
            ×{s}
          </button>
        ))}
      </div>
      <Btn variant="ghost" onClick={() => set({ replay: null })}>EXIT</Btn>
    </div>
  );
}
