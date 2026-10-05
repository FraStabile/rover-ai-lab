import { useEffect, useState, type ReactNode } from 'react';
import type { AppConfig, DeepPartial } from '@rover/protocol';
import { api } from '../lib/api';
import { useStore } from '../store';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Section({ title, right, children, className }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('border-b border-line px-3 py-2.5', className)}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="label">{title}</h3>
        {right}
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-2" title={hint}>
      <span className="truncate text-[11px] text-dim">{label}</span>
      <div className="flex items-center justify-end gap-1">{children}</div>
    </label>
  );
}

const inputCls =
  'h-6 rounded-sm border border-line2 bg-bg px-1.5 text-[11px] text-fg outline-none focus:border-accent num disabled:opacity-40';

export function NumField({
  value,
  onCommit,
  step = 0.1,
  min,
  max,
  unit,
  width = 'w-20',
  disabled,
}: {
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  width?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  const commit = () => {
    const n = Number(text);
    if (!Number.isFinite(n)) return setText(String(value));
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (clamped !== value) onCommit(clamped);
    setText(String(clamped));
  };
  return (
    <>
      <input
        type="number"
        className={cx(inputCls, width, 'text-right')}
        value={text}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
      />
      {unit && <span className="w-8 text-[10px] text-mute">{unit}</span>}
    </>
  );
}

export function TextField({
  value,
  onCommit,
  width = 'w-40',
  placeholder,
  mono = true,
}: {
  value: string;
  onCommit: (v: string) => void;
  width?: string;
  placeholder?: string;
  mono?: boolean;
}) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);
  return (
    <input
      className={cx(inputCls, width, !mono && 'font-sans')}
      value={text}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (text !== value) onCommit(text);
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
}

export function TextArea({ value, onCommit, rows = 5 }: { value: string; onCommit: (v: string) => void; rows?: number }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);
  return (
    <textarea
      className="w-full resize-y rounded-sm border border-line2 bg-bg p-1.5 font-mono text-[11px] text-fg outline-none focus:border-accent"
      rows={rows}
      value={text}
      spellCheck={false}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (text !== value) onCommit(text);
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
    />
  );
}

export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-4 w-7 rounded-full border transition-colors disabled:opacity-40',
        checked ? 'border-accent bg-accent/25' : 'border-line2 bg-bg',
      )}
    >
      <span className={cx('absolute top-[1px] h-3 w-3 rounded-full transition-all', checked ? 'left-[13px] bg-accent' : 'left-[1px] bg-mute')} />
    </button>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  width = 'w-28',
}: {
  value: T;
  options: Array<{ value: T; label: string }> | readonly T[];
  onChange: (v: T) => void;
  width?: string;
}) {
  const opts = (options as Array<{ value: T; label: string } | T>).map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
  return (
    <select
      className={cx(inputCls, width)}
      value={String(value)}
      onChange={(e) => {
        const found = opts.find((o) => String(o.value) === e.target.value);
        if (found) onChange(found.value);
      }}
    >
      {opts.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

type BtnVariant = 'default' | 'primary' | 'danger' | 'ghost' | 'warn' | 'ok';

export function Btn({
  children,
  onClick,
  variant = 'default',
  active,
  disabled,
  title,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const styles: Record<BtnVariant, string> = {
    default: 'border-line2 bg-panel2 text-fg hover:border-accent/60 hover:text-white',
    primary: 'border-accent/70 bg-accent/15 text-accent hover:bg-accent/25',
    danger: 'border-bad/70 bg-bad/15 text-bad hover:bg-bad/25',
    warn: 'border-warn/70 bg-warn/10 text-warn hover:bg-warn/20',
    ok: 'border-ok/70 bg-ok/10 text-ok hover:bg-ok/20',
    ghost: 'border-transparent bg-transparent text-dim hover:text-fg',
  };
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex h-6 items-center justify-center gap-1 rounded-sm border px-2 text-[11px] font-medium tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        styles[variant],
        active && 'border-accent bg-accent/20 text-accent',
        className,
      )}
    >
      {children}
    </button>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'accent' | 'dim' | 'violet';

const toneCls: Record<Tone, string> = {
  ok: 'border-ok/50 text-ok bg-ok/10',
  warn: 'border-warn/50 text-warn bg-warn/10',
  bad: 'border-bad/60 text-bad bg-bad/10',
  accent: 'border-accent/50 text-accent bg-accent/10',
  dim: 'border-line2 text-dim bg-panel2',
  violet: 'border-violet/50 text-violet bg-violet/10',
};

export function Badge({ tone = 'dim', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex h-5 items-center rounded-sm border px-1.5 font-mono text-[10px] font-semibold tracking-wider', toneCls[tone], className)}>{children}</span>;
}

export function KV({ k, v, tone }: { k: string; v: ReactNode; tone?: Tone }) {
  const color = tone ? { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', accent: 'text-accent', dim: 'text-dim', violet: 'text-violet' }[tone] : 'text-fg';
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] text-dim">{k}</span>
      <span className={cx('num text-[12px]', color)}>{v}</span>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: Array<{ id: T; label: string; badge?: ReactNode }>; className?: string }) {
  return (
    <div className={cx('flex border-b border-line bg-panel', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cx(
            'relative flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors',
            value === t.id ? 'text-accent' : 'text-dim hover:text-fg',
          )}
        >
          {t.label}
          {t.badge}
          {value === t.id && <span className="absolute inset-x-2 bottom-0 h-[2px] bg-accent" />}
        </button>
      ))}
    </div>
  );
}

export function JsonView({ value, className }: { value: string; className?: string }) {
  return <pre className={cx('json overflow-auto rounded-sm border border-line bg-bg p-2 text-[#9fb4c8]', className)}>{value}</pre>;
}

/** Sends a partial config patch to the server; the server broadcasts the result. */
export function usePatch() {
  const toast = useStore((s) => s.toast);
  return async (patch: DeepPartial<AppConfig>) => {
    try {
      await api.patchConfig(patch);
    } catch (err) {
      toast(`Config update failed: ${(err as Error).message}`, 'error');
    }
  };
}

export function useAction() {
  const toast = useStore((s) => s.toast);
  return async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    try {
      const r = await fn();
      if (ok) toast(ok);
      return r;
    } catch (err) {
      toast((err as Error).message, 'error');
      return undefined;
    }
  };
}
