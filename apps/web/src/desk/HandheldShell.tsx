'use client';

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { AbilityBadge } from '@/components/AbilityBadge';
import { GAME_TITLE } from '@/components/brand';
import { useFullscreen } from '@/hooks/useFullscreen';
import { isScreenMessage, type PadButton, type PadMessage, type ScreenMessage } from './handheldPad';
import styles from './HandheldShell.module.css';

const FRAME_ALLOW = 'fullscreen; gamepad; clipboard-write; autoplay';
type Dir = 'left' | 'right' | 'up' | 'down';
export type Send = (button: PadButton, down: boolean, extra?: Pick<PadMessage, 'x' | 'y' | 'cancel'>) => void;
export type Self = NonNullable<ScreenMessage['self']>;
/** The pad's look: a CSS module with the handheld's class names (the desk on phones has its own). */
export type PadSkin = Record<string, string>;

/**
 * Phones: the site in a pocket handheld. Its screen is an iframe of this same app; the D-pad,
 * buttons and the S thumbstick are the touch controls (handheldPad.ts turns them into game input
 * on the other side). Held upright the controls sit under the screen; turned sideways they split
 * left and right.
 */
export function HandheldShell({ onSwitch }: { onSwitch?: () => void } = {}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [src] = useState(() => window.location.pathname + window.location.search + window.location.hash);
  const fullscreen = useFullscreen();
  // The game on the screen says when it runs (held upright the screen then turns 16:9) and
  // whose ability is on the S stick.
  const [inGame, setInGame] = useState(false);
  const [self, setSelf] = useState<Self | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.shell = 'handheld';
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== window.location.origin) return;
      if (!isScreenMessage(event.data)) return;
      const { inGame: playing, self: next } = event.data;
      setInGame(playing);
      if (!playing) setSelf(null);
      else if (next !== undefined) setSelf(next);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      delete root.dataset.shell;
    };
  }, []);

  const send: Send = (button, down, extra) => {
    const message: PadMessage = { type: 'overgrown:pad', button, down, ...extra };
    frameRef.current?.contentWindow?.postMessage(message, window.location.origin);
  };
  const buzz = () => navigator.vibrate?.(8);

  return (
    <div className={styles.handheld} onContextMenu={(event) => event.preventDefault()}>
      <div className={styles.shell} data-ingame={inGame}>
        <span className={styles.grain} aria-hidden />
        <span className={styles.seam} aria-hidden />

        <div className={styles.bezel}>
          <div className={styles.strip}>
            <span className={styles.led} aria-hidden />
            <span className={styles.print} aria-hidden>
              Power
            </span>
            <span className={styles.stripe} aria-hidden />
            <span className={styles.stripName} aria-hidden>
              {GAME_TITLE}
            </span>
            <span className={`${styles.print} ${styles.linkLabel}`} aria-hidden>
              4-player link
            </span>
            {onSwitch && (
              <button type="button" className={styles.roomSwitch} onClick={onSwitch} aria-label="Switch to the computer room">
                Room
              </button>
            )}
          </div>
          <div className={styles.lcd}>
            <iframe ref={frameRef} className={styles.frame} src={src} title={GAME_TITLE} allow={FRAME_ALLOW} />
            <div className={styles.glass} aria-hidden />
          </div>
        </div>

        <div className={styles.brand} aria-hidden>
          <span className={styles.brandName}>{GAME_TITLE}</span>
          <span className={styles.pocket}>Pocket</span>
        </div>

        <div className={styles.dpadSlot}>
          <DPad send={send} buzz={buzz} />
        </div>

        <div className={styles.actions} role="group" aria-label="Actions">
          <SpecialStick send={send} buzz={buzz} self={self} />
          <PadKey button="b" label="B" caption="Attack" className={`${styles.round} ${styles.keyB}`} send={send} buzz={buzz} />
          <PadKey button="a" label="A" caption="Jump" className={`${styles.round} ${styles.keyA}`} send={send} buzz={buzz} />
        </div>

        <div className={`${styles.pillSlot} ${styles.selectSlot}`}>
          {fullscreen.supported && (
            <>
              <span className={styles.pillWell}>
                <button
                  type="button"
                  className={styles.pill}
                  aria-label={fullscreen.active ? 'Select: leave full screen' : 'Select: full screen'}
                  onClick={() => {
                    buzz();
                    fullscreen.toggle();
                  }}
                />
              </span>
              <span className={styles.engrave}>Select</span>
            </>
          )}
        </div>
        <div className={`${styles.pillSlot} ${styles.startSlot}`}>
          <PadKey button="start" caption="Start" className={styles.pill} ariaLabel="Start: pause menu" send={send} buzz={buzz} pill />
        </div>

        <div className={styles.speaker} aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A button that reports press and release (several thumbs at once are fine). */
export function PadKey({
  button,
  label,
  caption,
  className,
  ariaLabel,
  pill = false,
  send,
  buzz,
  skin = styles,
}: {
  button: PadButton;
  label?: string;
  caption: string;
  className?: string;
  ariaLabel?: string;
  pill?: boolean;
  send: Send;
  buzz: () => void;
  skin?: PadSkin;
}) {
  const styles = skin;
  const pressed = useRef(false);
  const set = (event: ReactPointerEvent<HTMLButtonElement>, down: boolean) => {
    if (pressed.current === down) return;
    pressed.current = down;
    event.currentTarget.dataset.pressed = String(down);
    if (down) buzz();
    send(button, down);
  };
  return (
    <span className={styles.keySlot} data-key={button}>
      <span className={pill ? styles.pillWell : styles.well}>
        <button
          type="button"
          className={className}
          aria-label={ariaLabel ?? `${label}: ${caption.toLowerCase()}`}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            set(event, true);
          }}
          onPointerUp={(event) => set(event, false)}
          onPointerCancel={(event) => set(event, false)}
          onLostPointerCapture={(event) => set(event, false)}
        >
          {label}
        </button>
      </span>
      <span className={styles.engrave}>{caption}</span>
    </span>
  );
}

/**
 * The special: a thumbstick. Drag to aim (the game shows the aim), let go to use it; let go near
 * the middle and it goes straight ahead. Its cap shows the recharge ring and the seconds left.
 */
export function SpecialStick({ send, buzz, self, skin = styles }: { send: Send; buzz: () => void; self: Self | null; skin?: PadSkin }) {
  const styles = skin;
  const drag = useRef<{ id: number; x0: number; y0: number; r: number; x: number; y: number } | null>(null);
  const [aim, setAim] = useState<{ x: number; y: number } | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;

  const end = (cancel: boolean) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setAim(null);
    sendRef.current('s', false, { x: d.x, y: d.y, cancel });
  };

  // Never leave the special held if the stick goes away mid-drag.
  useEffect(
    () => () => {
      const d = drag.current;
      if (d) sendRef.current('s', false, { x: d.x, y: d.y, cancel: true });
    },
    [],
  );

  const style = { '--sx': aim?.x ?? 0, '--sy': aim?.y ?? 0 } as CSSProperties;
  return (
    <span className={styles.keySlot} data-key="s">
      <span
        className={styles.stickBase}
        data-active={aim !== null}
        style={style}
        role="button"
        aria-label="S: special (drag to aim, let go to use)"
        onPointerDown={(event) => {
          if (drag.current) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          // The cap travels about a third of the base; where the thumb lands is the centre.
          const r = Math.max(1, event.currentTarget.offsetWidth * 0.3);
          drag.current = { id: event.pointerId, x0: event.clientX, y0: event.clientY, r, x: 0, y: 0 };
          setAim({ x: 0, y: 0 });
          buzz();
          send('s', true, { x: 0, y: 0 });
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          if (!d || d.id !== event.pointerId) return;
          let dx = event.clientX - d.x0;
          let dy = event.clientY - d.y0;
          const length = Math.hypot(dx, dy);
          if (length > d.r) {
            dx *= d.r / length;
            dy *= d.r / length;
          }
          d.x = dx / d.r;
          d.y = dy / d.r;
          setAim({ x: d.x, y: d.y });
          send('s', true, { x: d.x, y: d.y });
        }}
        onPointerUp={(event) => {
          if (drag.current?.id === event.pointerId) end(false);
        }}
        onPointerCancel={(event) => {
          if (drag.current?.id === event.pointerId) end(true);
        }}
        onLostPointerCapture={(event) => {
          if (drag.current?.id === event.pointerId) end(false);
        }}
      >
        <span className={styles.stickTicks} aria-hidden />
        <span className={styles.stickCap} aria-hidden>
          {self ? (
            <span className={styles.stickBadge}>
              <AbilityBadge
                characterId={self.characterId}
                ability={self.ability}
                size="fill"
                symbol={<span className={styles.stickLetter}>S</span>}
              />
            </span>
          ) : (
            <span className={styles.stickLetter}>S</span>
          )}
        </span>
      </span>
      <span className={styles.engrave}>Special</span>
    </span>
  );
}

/** The cross: one thumb, sliding between arms (diagonals press two). It rocks toward the press. */
export function DPad({ send, buzz, skin = styles }: { send: Send; buzz: () => void; skin?: PadSkin }) {
  const styles = skin;
  const ref = useRef<HTMLDivElement>(null);
  const held = useRef(new Set<Dir>());

  const update = (next: Set<Dir>) => {
    let pressed = false;
    for (const dir of held.current) if (!next.has(dir)) send(dir, false);
    for (const dir of next)
      if (!held.current.has(dir)) {
        send(dir, true);
        pressed = true;
      }
    if (pressed) buzz();
    held.current = next;
    const el = ref.current;
    if (!el) return;
    el.dataset.held = [...next].join(' ');
    el.style.setProperty('--tx', String((next.has('right') ? 1 : 0) - (next.has('left') ? 1 : 0)));
    el.style.setProperty('--ty', String((next.has('down') ? 1 : 0) - (next.has('up') ? 1 : 0)));
  };

  const fromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const r = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const y = (event.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const next = new Set<Dir>();
    if (Math.hypot(x, y) < 0.18) return next; // the hub: nothing
    const angle = Math.atan2(y, x); // 0 = right, +y down
    const sector = Math.round(angle / (Math.PI / 4)); // 8 directions
    const map: Record<number, Dir[]> = {
      0: ['right'],
      1: ['right', 'down'],
      2: ['down'],
      3: ['left', 'down'],
      4: ['left'],
      [-4]: ['left'],
      [-3]: ['left', 'up'],
      [-2]: ['up'],
      [-1]: ['right', 'up'],
    };
    for (const dir of map[sector] ?? []) next.add(dir);
    return next;
  };

  return (
    <div
      ref={ref}
      className={styles.dpad}
      role="group"
      aria-label="Move"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        update(fromPointer(event));
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) update(fromPointer(event));
      }}
      onPointerUp={() => update(new Set())}
      onPointerCancel={() => update(new Set())}
      onLostPointerCapture={() => update(new Set())}
    >
      <span className={styles.cross} aria-hidden>
        <span className={`${styles.arm} ${styles.armV}`} />
        <span className={`${styles.arm} ${styles.armH}`} />
        <span className={`${styles.arrow} ${styles.arrowUp}`} />
        <span className={`${styles.arrow} ${styles.arrowDown}`} />
        <span className={`${styles.arrow} ${styles.arrowLeft}`} />
        <span className={`${styles.arrow} ${styles.arrowRight}`} />
        <span className={styles.hub} />
      </span>
    </div>
  );
}
