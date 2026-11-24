'use client';

import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { TouchInput } from '@/game/input/TouchInput';
import { useTouchDevice } from '@/hooks/useTouchDevice';
import type { HudPlayer } from '@/net/RoomStore';
import { AbilityBadge } from './AbilityBadge';
import styles from './TouchControls.module.css';

/** The knob travels this far from the centre, as a fraction of the base's width. */
const KNOB_TRAVEL = 0.32;

/**
 * On-screen controls for touch devices, laid over the game view: a floating walk stick on the
 * left; attack and special sticks (special on top) and a jump button on the right. They write
 * into `touch`, which the scene's `InputController` reads every step. (The menu button is in the
 * HUD, where it can't cover the player chips.)
 */
export function TouchControls({ touch, self }: { touch: TouchInput; self: HudPlayer | undefined }) {
  const enabled = useTouchDevice();
  if (!enabled) return null;
  return (
    <div className={styles.layer} onContextMenu={(event) => event.preventDefault()}>
      <Stick touch={touch} kind="walk" className={styles.walkZone} floating>
        <WalkIcon />
      </Stick>
      <Stick touch={touch} kind="special" className={`${styles.fixed} ${styles.special}`}>
        <SpecialSymbol self={self} />
      </Stick>
      <Stick touch={touch} kind="attack" className={`${styles.fixed} ${styles.attack}`}>
        <FistIcon />
      </Stick>
      <JumpButton touch={touch} />
    </div>
  );
}

type StickKind = 'walk' | 'attack' | 'special';

/** What each stick does with the thumb's position (unit circle, +y down). */
const STICK_ACTIONS: Record<
  StickKind,
  { move(touch: TouchInput, x: number, y: number): void; end(touch: TouchInput, x: number, y: number, cancelled: boolean): void }
> = {
  walk: {
    move: (touch, x, y) => touch.setWalk(x, y),
    end: (touch) => touch.releaseWalk(),
  },
  attack: {
    move: () => {},
    end: (touch, x, _y, cancelled) => {
      if (!cancelled) touch.releaseAttack(x);
    },
  },
  special: {
    move: (touch, x, y) => touch.dragSpecial(x, y),
    end: (touch, x, y, cancelled) => (cancelled ? touch.cancelSpecial() : touch.releaseSpecial(x, y)),
  },
};

interface Drag {
  pointerId: number;
  /** Where the thumb landed (client px): the stick's centre, so a tap is always neutral. */
  originX: number;
  originY: number;
  /** Knob travel (px) that counts as full deflection. */
  radius: number;
  x: number;
  y: number;
}

/**
 * A virtual joystick. One thumb at a time (pointer capture keeps it, wherever it slides). The
 * knob is moved through its style directly, so dragging never re-renders React. `floating`: the
 * base jumps to where the thumb lands inside the (larger) zone and returns when it lifts.
 */
function Stick({
  touch,
  kind,
  className,
  floating = false,
  children,
}: {
  touch: TouchInput;
  kind: StickKind;
  className: string | undefined;
  floating?: boolean;
  children: ReactNode;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const actions = STICK_ACTIONS[kind];

  const end = (cancelled: boolean) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const base = baseRef.current;
    const knob = knobRef.current;
    if (base) {
      delete base.dataset.active;
      base.style.left = '';
      base.style.top = '';
    }
    if (knob) knob.style.transform = '';
    actions.end(touch, d.x, d.y, cancelled);
  };

  // Unmounted with a thumb down (menu opened): let go without firing.
  useEffect(
    () => () => {
      const d = drag.current;
      drag.current = null;
      if (d) STICK_ACTIONS[kind].end(touch, d.x, d.y, true);
    },
    [touch, kind],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const base = baseRef.current;
    if (drag.current || !base) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (floating) {
      const zone = event.currentTarget.getBoundingClientRect();
      const half = base.offsetWidth / 2;
      base.style.left = `${clamp(event.clientX - zone.left, half, zone.width - half)}px`;
      base.style.top = `${clamp(event.clientY - zone.top, half, zone.height - half)}px`;
    }
    base.dataset.active = 'true';
    drag.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      radius: Math.max(1, base.offsetWidth * KNOB_TRAVEL),
      x: 0,
      y: 0,
    };
    actions.move(touch, 0, 0);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    let dx = event.clientX - d.originX;
    let dy = event.clientY - d.originY;
    const length = Math.hypot(dx, dy);
    if (length > d.radius) {
      dx *= d.radius / length;
      dy *= d.radius / length;
    }
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
    d.x = dx / d.radius;
    d.y = dy / d.radius;
    actions.move(touch, d.x, d.y);
  };

  const onPointerEnd = (cancelled: boolean) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) end(cancelled);
  };

  return (
    <div
      className={className}
      aria-hidden
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd(false)}
      onPointerCancel={onPointerEnd(true)}
      onLostPointerCapture={onPointerEnd(true)}
    >
      <div ref={baseRef} className={styles.base}>
        <div ref={knobRef} className={styles.knob}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Held while a thumb is on it; the press is latched so a quick tap still jumps. */
function JumpButton({ touch }: { touch: TouchInput }) {
  const pointer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (pointer.current !== null) touch.releaseJump();
      pointer.current = null;
    },
    [touch],
  );

  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    delete event.currentTarget.dataset.active;
    touch.releaseJump();
  };

  return (
    <div
      className={styles.jump}
      aria-hidden
      onPointerDown={(event) => {
        if (pointer.current !== null) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        pointer.current = event.pointerId;
        event.currentTarget.dataset.active = 'true';
        touch.pressJump();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <JumpIcon />
    </div>
  );
}

/** The local character's ability: its icon in the recharge ring (see `AbilityBadge`). */
function SpecialSymbol({ self }: { self: HudPlayer | undefined }) {
  if (!self) return <StarIcon />;
  return (
    <span className={styles.ability}>
      <AbilityBadge characterId={self.characterId} ability={self.ability} color={self.color} size="fill" />
    </span>
  );
}

function clamp(value: number, min: number, max: number): number {
  return max < min ? (min + max) / 2 : Math.min(max, Math.max(min, value));
}

// --- icons (24 x 24, currentColor) -------------------------------------------------------------

/** Four-way arrows: walking. */
function WalkIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M12 1.5 16 6H8zM12 22.5 8 18h8zM1.5 12 6 8v8zM22.5 12 18 16V8z" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}

/** A clenched fist, knuckles up: attack. */
function FistIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden>
      <g fill="currentColor" stroke="rgb(16 19 31 / 85%)" strokeWidth="1.1" strokeLinejoin="round">
        <rect x="8.5" y="16" width="7" height="6.5" rx="1" />
        <rect x="5" y="8" width="14.5" height="10.5" rx="3.5" />
        <rect x="5.5" y="3.5" width="3.6" height="7.5" rx="1.8" />
        <rect x="9.1" y="2.5" width="3.6" height="8.5" rx="1.8" />
        <rect x="12.7" y="2.8" width="3.6" height="8.2" rx="1.8" />
        <rect x="16.3" y="4.2" width="3.4" height="7" rx="1.7" />
        <path d="M3.5 11.5c0-1.4 1.1-2.2 2.4-1.9l6.6 1.7c1.2.3 1.6 1.6.9 2.5l-.6.7c-.4.5-1 .7-1.6.6L5.4 14c-1.1-.2-1.9-1.2-1.9-2.5z" />
      </g>
    </svg>
  );
}

function JumpIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M12 3 21 13h-5.5v8h-7v-8H3z" />
    </svg>
  );
}

/** Fallback special symbol (no character yet). */
function StarIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="m12 2 2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.2l-6.1 3.4 1.4-6.8-5.1-4.7 6.9-.8z" />
    </svg>
  );
}
