'use client';

import { usePathname } from 'next/navigation';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { GAME_TITLE } from '@/components/brand';
import type { DeskHit, DeskScene, DeskView } from './deskScene';
import { HandheldShell, type Send, type Self } from './HandheldShell';
import { isScreenMessage, type PadMessage } from './handheldPad';
import { PhonePad, phonePadInset } from './PhonePad';
import { quadTransform } from './homography';
import styles from './SiteShell.module.css';

/**
 * `desk`: the page is the 3D desk, and the site runs inside the CRT (an iframe of this same app).
 * `phone`: the same desk on a phone: the CRT fills the top (or the middle, sideways) and a pad
 * over the room plays (the site on the screen runs as on the handheld, see handheldPad.ts).
 * `handheld`: the pocket console: phones without WebGL 2, or ones switched to it (a phone can
 * switch between the desk and the handheld; the choice is remembered). The site runs on its
 * screen the same way.
 * `flat`: the site on its own: inside either iframe, on tablets, small windows, without WebGL,
 * or with `?flat` in the address.
 */
type ShellMode = 'pending' | 'flat' | 'desk' | 'phone' | 'handheld';

/** A touch screen whose short side is phone-sized. */
const isPhone = () =>
  window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) <= 600;

let decided: ShellMode | null = null;
let webgl2: boolean | null = null;

const hasWebgl2 = () => {
  if (webgl2 === null) {
    try {
      webgl2 = Boolean(document.createElement('canvas').getContext('webgl2'));
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
};

/** Which look a phone was last switched to (the desk unless it chose the handheld). */
const PHONE_SHELL_KEY = 'overgrown:phone-shell';

function phoneChoice(): 'phone' | 'handheld' {
  try {
    return window.localStorage.getItem(PHONE_SHELL_KEY) === 'handheld' ? 'handheld' : 'phone';
  } catch {
    return 'phone';
  }
}

function detectMode(): ShellMode {
  if (window.self !== window.top) return 'flat';
  if (new URLSearchParams(window.location.search).has('flat')) return 'flat';
  if (isPhone()) return hasWebgl2() ? phoneChoice() : 'handheld';
  if (window.matchMedia('(pointer: coarse)').matches) return 'flat';
  if (window.innerWidth < 900 || window.innerHeight < 560) return 'flat';
  return hasWebgl2() ? 'desk' : 'flat';
}

// Decided once per page load, except that a phone can switch between the desk and the handheld
// (which restarts the site on the new screen, at the same address).
const getMode = () => (decided ??= detectMode());
const getServerMode = (): ShellMode => 'pending';
const listeners = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
};

function switchPhoneShell(next: 'phone' | 'handheld') {
  try {
    window.localStorage.setItem(PHONE_SHELL_KEY, next);
  } catch {
    // not remembered (private mode): it still switches for now
  }
  decided = next;
  for (const onChange of listeners) onChange();
}

export function SiteShell({ children }: { children: ReactNode }) {
  const mode = useSyncExternalStore(subscribe, getMode, getServerMode);
  if (mode === 'pending') return <div className={styles.pending} />;
  if (mode === 'flat') {
    return (
      <>
        {children}
        <FramedSync />
      </>
    );
  }
  if (mode === 'handheld') return <HandheldShell onSwitch={hasWebgl2() ? () => switchPhoneShell('phone') : undefined} />;
  return <DeskShell phone={mode === 'phone'} />;
}

/** Inside the CRT or the handheld: keep the outer page's address and title in step with the site. */
function FramedSync() {
  const pathname = usePathname();
  useEffect(() => {
    if (window.self === window.top) return;
    document.documentElement.dataset.crt = '';
    let outer: Window;
    try {
      outer = window.parent;
      void outer.location.href; // throws if not same-origin
    } catch {
      return;
    }
    const sync = () => {
      outer.history.replaceState(outer.history.state, '', window.location.href);
      outer.document.title = document.title;
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [pathname]);
  return null;
}

function DeskShell({ phone }: { phone: boolean }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const sceneRef = useRef<DeskScene | null>(null);
  const sizeRef = useRef({ w: 1, h: 1 });
  const [src] = useState(() => window.location.pathname + window.location.search + window.location.hash);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<DeskView>('room');
  const [moving, setMoving] = useState(false);
  // The computer waits switched off in the room; a click (or a key) turns it on and sits down.
  const [on, setOn] = useState(false);
  const onRef = useRef(false);
  // An item picked up off the desk (its name), and whether it is still off the desk: the site on
  // the screen steps aside until it is back down.
  const [held, setHeld] = useState<string | null>(null);
  const heldRef = useRef<string | null>(null);
  const [lifted, setLifted] = useState(false);
  // What the pointer is on, and the little label that follows it.
  const [hover, setHover] = useState<DeskHit | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  // Fingers on the stage while an item is held: two of them pinch it closer or further.
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  // On a phone: whose ability is on the pad's S stick (the game on the screen says).
  const [self, setSelf] = useState<Self | null>(null);

  // On a phone the site on the screen runs as on the handheld: pocket-sized screens, played with
  // the pad (handheldPad.ts reads this before the frame loads).
  useEffect(() => {
    if (!phone) return;
    const root = document.documentElement;
    root.dataset.shell = 'handheld';
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== window.location.origin) return;
      if (!isScreenMessage(event.data)) return;
      const { inGame, self: next } = event.data;
      if (!inGame) setSelf(null);
      else if (next !== undefined) setSelf(next);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      delete root.dataset.shell;
    };
  }, [phone]);

  const send: Send = (button, down, extra) => {
    const message: PadMessage = { type: 'overgrown:pad', button, down, ...extra };
    frameRef.current?.contentWindow?.postMessage(message, window.location.origin);
  };

  useEffect(() => {
    let disposed = false;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    import('./deskScene')
      .then(({ createDeskScene }) =>
        createDeskScene(stageRef.current!, {
          reducedMotion,
          startOff: true,
          phone,
          fitInset: phone ? phonePadInset : undefined,
          onProgress: setProgress,
          onLayout: (w, h) => {
            sizeRef.current = { w, h };
            const el = screenRef.current;
            if (el) {
              el.style.width = `${w}px`;
              el.style.height = `${h}px`;
            }
          },
          onScreen: (quad) => {
            const el = screenRef.current;
            if (el) el.style.transform = quadTransform(sizeRef.current.w, sizeRef.current.h, quad);
          },
          onSettled: (settled) => {
            setMoving(false);
            setView(settled);
            if (settled === 'screen' && !heldRef.current) frameRef.current?.contentWindow?.focus();
          },
          onHoverChange: setHover,
          onPutBack: () => {
            setLifted(false);
            if (sceneRef.current?.view === 'screen' && !heldRef.current) frameRef.current?.contentWindow?.focus();
          },
        }),
      )
      .then((scene) => {
        if (disposed) return scene.dispose();
        sceneRef.current = scene;
        setReady(true);
      })
      .catch((error: unknown) => {
        console.error('[desk] could not load the scene', error);
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  const goTo = (next: DeskView) => {
    const scene = sceneRef.current;
    if (!scene || scene.view === next) return;
    setMoving(true);
    setView(next);
    scene.setView(next);
  };

  const powerOn = () => {
    const scene = sceneRef.current;
    if (!scene || onRef.current) return;
    onRef.current = true;
    setOn(true);
    scene.setPower(true);
    if (!heldRef.current) goTo('screen');
  };

  const powerOff = () => {
    const scene = sceneRef.current;
    if (!scene || !onRef.current) return;
    onRef.current = false;
    setOn(false);
    scene.setPower(false);
    goTo('room');
  };

  const pickUp = (hit: DeskHit & { kind: 'item' }) => {
    const scene = sceneRef.current;
    if (!scene || heldRef.current) return;
    heldRef.current = hit.label;
    setHeld(hit.label);
    setLifted(true);
    setHover(null);
    scene.inspect(hit.id);
  };

  const putBack = () => {
    if (!heldRef.current) return;
    heldRef.current = null;
    setHeld(null);
    sceneRef.current?.inspect(null);
  };

  const tipAt = useRef('translate(0px, 0px)');
  const moveTip = (x: number, y: number) => {
    tipAt.current = `translate(${Math.round(x + 16)}px, ${Math.round(y + 18)}px)`;
    if (tipRef.current) tipRef.current.style.transform = tipAt.current;
  };

  // The room under the pointer: pick things up, flip the power switch, sit down at the screen.
  const onStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (fingers.current.size === 1) drag.current = { x: event.clientX, y: event.clientY, moved: false };
    else if (drag.current) drag.current.moved = true; // a second finger: a pinch, not a tap
    pinch.current = 0;
    if (heldRef.current) event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onStagePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    fingers.current.delete(event.pointerId);
    pinch.current = 0;
  };

  const onStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (fingers.current.has(event.pointerId)) fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (heldRef.current && fingers.current.size >= 2) {
      const [a, b] = [...fingers.current.values()];
      const spread = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinch.current > 0) scene.zoomItem(spread / pinch.current);
      pinch.current = spread;
      return;
    }
    const d = drag.current;
    if (d && heldRef.current && event.buttons) {
      const dx = event.clientX - d.x;
      const dy = event.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      d.x = event.clientX;
      d.y = event.clientY;
      scene.turnItem(dx * 0.01, dy * 0.01);
      return;
    }
    const hit = event.pointerType === 'touch' ? null : scene.hover(event.clientX, event.clientY);
    moveTip(event.clientX, event.clientY);
    setHover((prev) => (prev?.kind === hit?.kind && prev?.label === hit?.label ? prev : hit));
  };

  const onStageClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const scene = sceneRef.current;
    const d = drag.current;
    drag.current = null;
    if (!scene || d?.moved) return;
    const hit = scene.hitTest(event.clientX, event.clientY);
    // whatever happens next moves things under the pointer: the label waits for the next move
    scene.hover(null);
    setHover(null);
    if (heldRef.current) {
      if (!hit) putBack();
      return;
    }
    if (hit?.kind === 'item') pickUp(hit);
    else if (hit?.kind === 'power') (onRef.current ? powerOff : powerOn)();
    else if (!onRef.current) powerOn();
    else if (scene.view === 'room') goTo('screen');
  };

  const onStageLeave = () => {
    sceneRef.current?.hover(null);
    setHover(null);
  };

  // Keys pressed while the outer page has focus belong to the game on the screen; with the
  // computer still off, any key switches it on. Holding an item, the keys turn it instead.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (heldRef.current) {
        const scene = sceneRef.current;
        const turns: Record<string, [number, number]> = {
          ArrowLeft: [-0.3, 0],
          ArrowRight: [0.3, 0],
          ArrowUp: [0, -0.3],
          ArrowDown: [0, 0.3],
        };
        if (event.key === 'Escape') putBack();
        else if (turns[event.key]) scene?.turnItem(...turns[event.key]!);
        else if (event.key === '+' || event.key === '=') scene?.zoomItem(1.2);
        else if (event.key === '-' || event.key === '_') scene?.zoomItem(1 / 1.2);
        else return;
        event.preventDefault();
        return;
      }
      if (!onRef.current) {
        if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.key === 'Tab') return;
        if (!sceneRef.current) return;
        event.preventDefault();
        powerOn();
        return;
      }
      if (sceneRef.current?.view === 'screen') frameRef.current?.contentWindow?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (failed) {
    // No 3D after all: the site on its own, in this page.
    return <iframe className={styles.flatFrame} src={src} title={GAME_TITLE} allow="fullscreen; gamepad; clipboard-write; autoplay" />;
  }

  const atScreen = view === 'screen' && !moving;
  return (
    <div
      className={styles.desk}
      data-view={view}
      data-ready={ready}
      data-power={on ? 'on' : 'off'}
      data-held={held !== null}
      data-lifted={lifted}
      data-hover={hover?.kind ?? 'none'}
      data-phone={phone}
    >
      <div
        ref={stageRef}
        className={styles.stage}
        aria-hidden
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerEnd}
        onPointerCancel={onStagePointerEnd}
        onPointerLeave={onStageLeave}
        onClick={onStageClick}
        onWheel={(event) => heldRef.current && sceneRef.current?.zoomItem(Math.exp(-event.deltaY * 0.0015))}
      />

      <div ref={screenRef} className={styles.screen}>
        <iframe
          ref={frameRef}
          className={styles.frame}
          src={src}
          title={GAME_TITLE}
          allow="fullscreen; gamepad; clipboard-write; autoplay"
          onLoad={() => {
            if (sceneRef.current?.view === 'screen') frameRef.current?.contentWindow?.focus();
          }}
        />
        <div className={styles.glass} aria-hidden />
        {on && view === 'room' && !moving && (
          <button type="button" className={styles.screenCatcher} onClick={() => goTo('screen')} aria-label="Sit down at the computer" />
        )}
      </div>

      {hover && !held && (
        <div ref={tipRef} className={`${styles.tip} px-notch`} style={{ transform: tipAt.current }} aria-hidden>
          <span className={styles.tipTitle}>{hover.kind === 'item' ? hover.label : 'Power'}</span>
          <span className={styles.tipAction}>{hover.kind === 'item' ? 'Click to pick up' : hover.label}</span>
        </div>
      )}

      {ready && !on && !held && (
        <div className={styles.powerBar}>
          <button type="button" className={`${styles.powerHint} px-notch`} onClick={powerOn} autoFocus>
            {phone ? 'Tap anywhere to turn on the computer' : 'Click anywhere to turn on the computer'}
          </button>
          <span className={styles.powerTip}>Things on the desk can be picked up</span>
        </div>
      )}

      {held && (
        <div className={`${styles.inspectBar} px-notch`} role="dialog" aria-label={held}>
          <span className={styles.inspectName}>{held}</span>
          <span className={styles.inspectHelp}>
            {phone ? 'Drag to turn · Pinch to zoom' : 'Drag or arrow keys to turn · Scroll to zoom'}
          </span>
          <button type="button" className={`${styles.putBack} px-notch`} onClick={putBack} autoFocus>
            Put back
          </button>
        </div>
      )}

      {phone && on && atScreen && !held && <PhonePad send={send} self={self} onLeanBack={() => goTo('room')} />}

      {phone && ready && view === 'room' && !moving && !held && (
        <button type="button" className={`${styles.shellSwitch} px-notch`} onClick={() => switchPhoneShell('handheld')}>
          <HandheldIcon />
          Handheld
        </button>
      )}

      <div className={styles.controls}>
        <button
          type="button"
          className={`${styles.viewButton} px-notch`}
          onClick={() => goTo(atScreen ? 'room' : 'screen')}
          disabled={!ready || moving}
        >
          {atScreen ? 'Lean back' : 'Back to the screen'}
        </button>
      </div>

      {!ready && (
        <div className={styles.loader} role="status">
          <span className={`${styles.loaderTitle} px-outline`}>{GAME_TITLE}</span>
          <span className={styles.bar} aria-hidden>
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
          <span className={styles.loaderText}>Setting up the room…</span>
        </div>
      )}
    </div>
  );
}

/** A little pocket console (the switch to the handheld look). */
function HandheldIcon() {
  return (
    <svg className={styles.shellIcon} viewBox="0 0 16 16" aria-hidden>
      <path fill="currentColor" fillRule="evenodd" d="M3 1h10v14H3zM5 3v5h6V3zM6 10h1v1h1v1H7v1H6v-1H5v-1h1zM10 10h1v1h-1zM9 12h1v1H9z" />
    </svg>
  );
}
