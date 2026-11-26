'use client';

import { useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { usePadAsKeys, useScreenKind, type ScreenKind } from './screenEnv';
import ui from './ScreenStage.module.css';

/**
 * The site on a screen of its own (the CRT or the pocket handheld) is drawn on a fixed stage, not
 * a page: 960 × 720 design pixels on the CRT, 300 × 404 on the handheld, scaled to fit the glass
 * and letterboxed. Nothing scrolls. Every screen has the same frame: a status line on top and a
 * hint bar naming the controls at hand (keys on the CRT, the pad's buttons on the handheld).
 */
export const STAGE: Record<ScreenKind, { w: number; h: number }> = {
  crt: { w: 960, h: 720 },
  pocket: { w: 300, h: 404 },
};

/** The screen this page is on (the CRT when not framed: the stage still works on its own). */
export function useStageKind(): ScreenKind {
  return useScreenKind() ?? 'crt';
}

function useStageScale(kind: ScreenKind): number {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const { w, h } = STAGE[kind];
    const fit = () => setScale(Math.min(window.innerWidth / w, window.innerHeight / h));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [kind]);
  return scale;
}

/** A control the hint bar names. A `key` with no `pocket` twin is left out on the handheld. */
export type HintControl = 'move' | 'moveV' | 'moveH' | 'confirm' | 'back' | { key: string; pocket?: string };
export interface Hint {
  controls: HintControl[];
  label: string;
}

export function ScreenStage({
  crumb,
  status,
  hints,
  hintsRight,
  tone,
  children,
  label,
}: {
  crumb: ReactNode;
  status?: ReactNode;
  hints: Hint[];
  hintsRight?: (Hint | string)[];
  /** The stage's backdrop glow. */
  tone?: 'title' | 'glow';
  children: ReactNode;
  label: string;
}) {
  const kind = useStageKind();
  const scale = useStageScale(kind);
  usePadAsKeys(kind === 'pocket');
  const { w, h } = STAGE[kind];
  const style = { width: w, height: h, transform: `translate(-50%, -50%) scale(${scale})` } as CSSProperties;
  return (
    <div className={ui.root} data-kind={kind}>
      <main className={ui.stage} style={style} data-tone={tone ?? 'glow'} aria-label={label}>
        {children}
        <header className={ui.status}>
          <span className={ui.crumb}>{crumb}</span>
          <span className={ui.spacer} />
          {status}
        </header>
        <footer className={ui.hints}>
          {hints.map((hint) => (
            <HintItem key={hint.label} hint={hint} kind={kind} />
          ))}
          <span className={ui.spacer} />
          {hintsRight?.map((hint) =>
            typeof hint === 'string' ? (
              <span key={hint}>{hint}</span>
            ) : (
              <HintItem key={hint.label} hint={hint} kind={kind} />
            ),
          )}
        </footer>
      </main>
    </div>
  );
}

function HintItem({ hint, kind }: { hint: Hint; kind: ScreenKind }) {
  if (kind === 'pocket' && hint.controls.every((c) => typeof c === 'object' && !c.pocket)) return null;
  return (
    <span className={ui.hint}>
      {hint.controls.map((control, i) => (
        <Glyph key={i} control={control} kind={kind} />
      ))}
      {hint.label}
    </span>
  );
}

const CAPS: Record<string, string[]> = {
  move: ['↑', '↓', '←', '→'],
  moveV: ['↑', '↓'],
  moveH: ['←', '→'],
  confirm: ['Enter'],
  back: ['Esc'],
};

function Glyph({ control, kind }: { control: HintControl; kind: ScreenKind }) {
  if (kind === 'pocket') {
    if (control === 'move' || control === 'moveV' || control === 'moveH') return <span className={ui.plus} aria-label="D-pad" />;
    if (control === 'confirm') return <PadA />;
    if (control === 'back') return <span className={ui.padB}>B</span>;
    if (control.pocket) return <span className={ui.padPill}>{control.pocket}</span>;
    return null;
  }
  const keys = typeof control === 'string' ? CAPS[control]! : [control.key];
  return (
    <>
      {keys.map((key) => (
        <Key key={key} gold={control === 'confirm'}>
          {key}
        </Key>
      ))}
    </>
  );
}

export function Key({ children, gold = false, className }: { children: ReactNode; gold?: boolean; className?: string }) {
  return (
    <kbd className={[ui.key, className].filter(Boolean).join(' ')} data-gold={gold}>
      {children}
    </kbd>
  );
}

export function PadA({ className }: { className?: string }) {
  return <span className={[ui.padA, className].filter(Boolean).join(' ')}>A</span>;
}

/** The server line on the status bar. */
export function OnlineStatus({ state, children }: { state: 'ok' | 'wait' | 'down'; children: ReactNode }) {
  return (
    <span className={ui.online} data-state={state} role="status">
      <span className={ui.dot} aria-hidden />
      {children}
    </span>
  );
}
