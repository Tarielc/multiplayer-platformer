'use client';

import { useEffect, useId, useState } from 'react';
import {
  enterFullscreen,
  fullscreenSupported,
  isIPhone,
  isStandalone,
  useFullscreen,
} from '@/hooks/useFullscreen';
import { useTouchDevice } from '@/hooks/useTouchDevice';
import { GAME_TITLE } from './brand';
import { FullscreenIcon } from './FullscreenButton';
import styles from './FullscreenPrompt.module.css';

/** "Don't ask again" on this device. */
const NEVER_KEY = 'platformer.fullscreenPrompt';
/** Answered once in this tab: don't ask again on the next room. */
const ASKED_KEY = 'platformer.fullscreenAsked';

type Variant = 'fullscreen' | 'install';

/** Which suggestion fits this browser, or null when there is nothing to suggest. */
function pickVariant(): Variant | null {
  if (isStandalone()) return null;
  try {
    if (localStorage.getItem(NEVER_KEY) === 'never' || sessionStorage.getItem(ASKED_KEY) === '1') return null;
  } catch {
    // Storage blocked (private mode): ask anyway.
  }
  if (fullscreenSupported()) return 'fullscreen';
  if (isIPhone()) return 'install';
  return null;
}

/**
 * Bottom sheet that suggests full screen on a phone or tablet, once per tab, when entering a
 * room. Never blocks: the lobby stays usable behind it. Where element full screen doesn't exist
 * (iPhone Safari) it explains Add to Home Screen instead, which opens the game without bars.
 */
export function FullscreenPrompt({ ready }: { ready: boolean }) {
  const touch = useTouchDevice();
  const { active } = useFullscreen();
  const [variant, setVariant] = useState<Variant | null>(null);
  const [never, setNever] = useState(false);
  const titleId = useId();

  // Browser-only checks: decide after hydration, once the room is joined.
  useEffect(() => {
    if (ready && touch) setVariant(pickVariant());
  }, [ready, touch]);

  if (!variant || active) return null;

  const close = () => {
    try {
      sessionStorage.setItem(ASKED_KEY, '1');
      if (never) localStorage.setItem(NEVER_KEY, 'never');
    } catch {
      // Storage blocked: the sheet just comes back next time.
    }
    setVariant(null);
  };

  const goFullscreen = () => {
    // Called straight from the tap: browsers only allow full screen from a user gesture.
    void enterFullscreen();
    close();
  };

  const install = variant === 'install';

  return (
    <section className={`${styles.sheet} px-panel`} role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <div className={styles.head}>
        <span className={`${styles.badge} px-notch`}>
          <FullscreenIcon size={32} />
        </span>
        <div className={styles.titles}>
          <span className={styles.kicker}>Better on a phone</span>
          <h2 id={titleId} className="px-outline">
            {install ? 'Install for full screen' : 'Play full screen?'}
          </h2>
        </div>
      </div>

      <p className={styles.body}>
        {install
          ? `Safari on iPhone keeps its bars over games. Added to your home screen, ${GAME_TITLE} opens edge to edge with room for both sticks.`
          : 'Hides the browser bars so the stage and the touch sticks get the whole screen. Turn your phone sideways once the match starts.'}
      </p>

      {install && (
        <ol className={styles.steps}>
          <li>
            <span className={styles.stepNo}>1</span>
            Tap Share
            <ShareIcon />
            in Safari&rsquo;s bar
          </li>
          <li>
            <span className={styles.stepNo}>2</span>
            Choose Add to Home Screen
          </li>
          <li>
            <span className={styles.stepNo}>3</span>
            Open {GAME_TITLE} from its icon
          </li>
        </ol>
      )}

      <div className={styles.actions}>
        {!install && (
          <button type="button" className={`primary ${styles.go}`} onClick={goFullscreen}>
            <FullscreenIcon size={18} />
            Go full screen
          </button>
        )}
        <button type="button" onClick={close}>
          {install ? 'Maybe later' : 'Not now'}
        </button>
      </div>

      <label className={styles.never}>
        <input type="checkbox" checked={never} onChange={(e) => setNever(e.target.checked)} />
        Don&rsquo;t ask again on this device
      </label>
    </section>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 9 10" width="18" height="20" shapeRendering="crispEdges" aria-hidden>
      <path fill="currentColor" d="M4 0h1v1h1v1h1v1h-2v4h-1v-4h-2v-1h1v-1h1zM0 4h3v1h-2v4h7v-4h-2v-1h3v6h-9z" />
    </svg>
  );
}
