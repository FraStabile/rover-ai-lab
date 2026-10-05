import { useEffect, useRef, useState } from 'react';
import { send } from '../lib/ws';
import { useStore } from '../store';
import { Btn } from './ui';

const KEYS: Record<string, [number, number]> = {
  w: [1, 0],
  arrowup: [1, 0],
  s: [-1, 0],
  arrowdown: [-1, 0],
  a: [0, 1],
  arrowleft: [0, 1],
  d: [0, -1],
  arrowright: [0, -1],
};

/** Keyboard + on-screen teleoperation. Sends throttle/steering at 10 Hz (server applies a dead-man timeout). */
export function ManualPad() {
  const mode = useStore((s) => s.mode);
  const replay = useStore((s) => s.replay);
  const [throttle, setThrottle] = useState(0);
  const [steering, setSteering] = useState(0);
  const [gain, setGain] = useState(0.6);
  const pressed = useRef(new Set<string>());
  const [keyCmd, setKeyCmd] = useState<[number, number]>([0, 0]);
  const enabled = mode === 'MANUAL' && !replay;

  useEffect(() => {
    if (!enabled) return;
    const recompute = () => {
      let t = 0;
      let s = 0;
      for (const k of pressed.current) {
        const v = KEYS[k];
        if (v) {
          t += v[0];
          s += v[1];
        }
      }
      setKeyCmd([Math.max(-1, Math.min(1, t)), Math.max(-1, Math.min(1, s))]);
    };
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (k === ' ') {
        e.preventDefault();
        pressed.current.clear();
        setThrottle(0);
        setSteering(0);
        recompute();
        send({ type: 'manual', throttle: 0, steering: 0 });
        return;
      }
      if (KEYS[k]) {
        e.preventDefault();
        pressed.current.add(k);
        recompute();
      }
    };
    const up = (e: KeyboardEvent) => {
      pressed.current.delete(e.key.toLowerCase());
      recompute();
    };
    const blur = () => {
      pressed.current.clear();
      recompute();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [enabled]);

  const keyActive = keyCmd[0] !== 0 || keyCmd[1] !== 0;
  const t = keyActive ? keyCmd[0] * gain : throttle;
  const s = keyActive ? keyCmd[1] * gain : steering;

  useEffect(() => {
    if (!enabled) return;
    send({ type: 'manual', throttle: t, steering: s });
    if (t === 0 && s === 0) return;
    const id = setInterval(() => send({ type: 'manual', throttle: t, steering: s }), 100);
    return () => clearInterval(id);
  }, [t, s, enabled]);

  if (!enabled) return null;

  const step = (setter: (fn: (v: number) => number) => void, d: number) => setter((v) => Math.round(Math.max(-1, Math.min(1, v + d)) * 10) / 10);

  return (
    <div className="flex items-center gap-3 border-t border-line bg-panel px-3 py-1.5">
      <span className="label text-accent">Manual</span>
      <div className="grid grid-cols-3 gap-0.5 font-mono text-[10px]">
        <span />
        <Key on={keyCmd[0] > 0}>W</Key>
        <span />
        <Key on={keyCmd[1] > 0}>A</Key>
        <Key on={keyCmd[0] < 0}>S</Key>
        <Key on={keyCmd[1] < 0}>D</Key>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-dim">THR</span>
        <Btn onClick={() => step(setThrottle, -0.1)}>−</Btn>
        <input type="range" min={-1} max={1} step={0.05} value={throttle} onChange={(e) => setThrottle(Number(e.target.value))} className="w-24" />
        <Btn onClick={() => step(setThrottle, 0.1)}>+</Btn>
        <span className="num w-10 text-right text-[11px]">{t.toFixed(2)}</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-dim">STR</span>
        <Btn onClick={() => step(setSteering, 0.1)}>◀</Btn>
        <input type="range" min={-1} max={1} step={0.05} value={-steering} onChange={(e) => setSteering(-Number(e.target.value))} className="w-24" />
        <Btn onClick={() => step(setSteering, -0.1)}>▶</Btn>
        <span className="num w-10 text-right text-[11px]">{s.toFixed(2)}</span>
      </div>
      <Btn
        variant="danger"
        onClick={() => {
          setThrottle(0);
          setSteering(0);
          send({ type: 'manual', throttle: 0, steering: 0 });
        }}
      >
        STOP (space)
      </Btn>
      <div className="ml-auto flex items-center gap-1">
        <span className="text-[10px] text-dim">key gain</span>
        <input type="range" min={0.1} max={1} step={0.05} value={gain} onChange={(e) => setGain(Number(e.target.value))} className="w-20" />
        <span className="num w-8 text-[11px]">{gain.toFixed(2)}</span>
      </div>
    </div>
  );
}

function Key({ on, children }: { on: boolean; children: string }) {
  return <span className={`flex h-4 w-5 items-center justify-center rounded-[2px] border ${on ? 'border-accent bg-accent/30 text-white' : 'border-line2 text-dim'}`}>{children}</span>;
}
