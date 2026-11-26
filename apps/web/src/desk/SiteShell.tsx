'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { GAME_TITLE } from '@/components/brand';
import type { DeskScene, DeskView } from './deskScene';
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
            if (settled === 'screen') frameRef.current?.contentWindow?.focus();
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
    if (!scene) return;
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
    goTo('screen');
  };

  // Keys pressed while the outer page has focus belong to the game on the screen; with the
  // computer still off, any key switches it on.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
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
    <div className={styles.desk} data-view={view} data-ready={ready} data-power={on ? 'on' : 'off'}>
      <div ref={stageRef} className={styles.stage} aria-hidden onClick={() => view === 'room' && goTo('screen')} />

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

      {ready && !on && (
        <button type="button" className={styles.powerCatcher} onClick={powerOn} autoFocus>
          <span className={`${styles.powerHint} px-notch`}>Click anywhere to turn on the computer</span>
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
