'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** Safari before 16.4 (iPad) only has the prefixed API. */
interface WebkitDocument extends Document {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface WebkitElement extends HTMLElement {
  webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void> | void;
}

const STANDALONE = '(display-mode: standalone), (display-mode: fullscreen)';

function fullscreenElement(): Element | null {
  const doc = document as WebkitDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/** Element full screen can be asked for here. False on iPhone, where Safari only allows it for video. */
export function fullscreenSupported(): boolean {
  const doc = document as WebkitDocument;
  return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

/** Opened from a home-screen icon (installed web app): the browser bars are already gone. */
export function isStandalone(): boolean {
  return (
    window.matchMedia(STANDALONE).matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPhone / iPod Safari: no element full screen, but Add to Home Screen gives the same result. */
export function isIPhone(): boolean {
  return /iPhone|iPod/.test(navigator.userAgent);
}

export async function enterFullscreen(): Promise<boolean> {
  const root = document.documentElement as WebkitElement;
  try {
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen();
    else return false;
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  const doc = document as WebkitDocument;
  if (!fullscreenElement()) return;
  try {
    if (doc.exitFullscreen) await doc.exitFullscreen();
    else await doc.webkitExitFullscreen?.();
  } catch {
    // Already left (the player swiped out): nothing to do.
  }
}

/**
 * Keep a phone sideways while the game runs. Browsers only allow this in full screen, and some
 * (desktop, iPad) never do: failures are expected and ignored. Returns the undo.
 */
export function lockLandscape(): () => void {
  // Typed as always there, but Safari before 16.4 has no screen.orientation and iOS no lock().
  const orientation = screen.orientation as ScreenOrientation | undefined;
  if (typeof orientation?.lock !== 'function') return () => {};
  let locked = false;
  orientation
    .lock('landscape')
    .then(() => {
      locked = true;
    })
    .catch(() => {});
  return () => {
    if (locked) orientation.unlock();
  };
}

function subscribe(onChange: () => void): () => void {
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
  return () => {
    document.removeEventListener('fullscreenchange', onChange);
    document.removeEventListener('webkitfullscreenchange', onChange);
  };
}

export interface Fullscreen {
  /** The browser can go full screen (false during server render). */
  supported: boolean;
  /** The page is full screen right now. */
  active: boolean;
  toggle: () => void;
}

export function useFullscreen(): Fullscreen {
  const supported = useSyncExternalStore(subscribe, fullscreenSupported, () => false);
  const active = useSyncExternalStore(subscribe, () => fullscreenElement() !== null, () => false);
  const toggle = useCallback(() => {
    if (fullscreenElement()) void exitFullscreen();
    else void enterFullscreen();
  }, []);
  return { supported, active, toggle };
}

/** Subscribes to a media query (false during server render). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
