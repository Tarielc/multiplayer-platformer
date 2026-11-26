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
import { HandheldShell } from './HandheldShell';
import { quadTransform } from './homography';
import styles from './SiteShell.module.css';

/**
 * `desk`: the page is the 3D desk, and the site runs inside the CRT (an iframe of this same app).
 * `handheld`: phones get a pocket console instead; the site runs on its screen the same way.
 * `flat`: the site on its own: inside either iframe, on tablets, small windows, without WebGL,
 * or with `?flat` in the address.
 */
type ShellMode = 'pending' | 'flat' | 'desk' | 'handheld';

/** A touch screen whose short side is phone-sized. */
const isPhone = () =>
  window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) <= 600;

let decided: ShellMode | null = null;

function detectMode(): ShellMode {
  if (window.self !== window.top) return 'flat';
  if (new URLSearchParams(window.location.search).has('flat')) return 'flat';
  if (isPhone()) return 'handheld';
  if (window.matchMedia('(pointer: coarse)').matches) return 'flat';
  if (window.innerWidth < 900 || window.innerHeight < 560) return 'flat';
  try {
    if (!document.createElement('canvas').getContext('webgl2')) return 'flat';
  } catch {
    return 'flat';
  }
  return 'desk';
}

// Decided once per page load: switching later would restart the site (and drop a room).
const getMode = () => (decided ??= detectMode());
const getServerMode = (): ShellMode => 'pending';
const subscribe = () => () => {};

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
  if (mode === 'handheld') return <HandheldShell />;
  return <DeskShell />;
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

function DeskShell() {
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

  useEffect(() => {
    let disposed = false;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    import('./deskScene')
      .then(({ createDeskScene }) =>
        createDeskScene(stageRef.current!, {
          reducedMotion,
          startOff: true,
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
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
    if (heldRef.current) event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onStagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const scene = sceneRef.current;
    if (!scene) return;
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
    >
      <div
        ref={stageRef}
        className={styles.stage}
        aria-hidden
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
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
            Click anywhere to turn on the computer
          </button>
          <span className={styles.powerTip}>Things on the desk can be picked up</span>
        </div>
      )}

      {held && (
        <div className={`${styles.inspectBar} px-notch`} role="dialog" aria-label={held}>
          <span className={styles.inspectName}>{held}</span>
          <span className={styles.inspectHelp}>Drag or arrow keys to turn · Scroll to zoom</span>
          <button type="button" className={`${styles.putBack} px-notch`} onClick={putBack} autoFocus>
            Put back
          </button>
        </div>
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
