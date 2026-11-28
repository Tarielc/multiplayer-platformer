'use client';

import { useFullscreen } from '@/hooks/useFullscreen';
import type { CSSProperties } from 'react';
import { DPad, PadKey, SpecialStick, padScale, usePadScale, type Send, type Self } from './HandheldShell';
import styles from './PhonePad.module.css';

/**
 * The desk on a phone: the handheld's pad (D-pad, A / B, the S thumbstick, SELECT and START) laid
 * over the room around the computer, in the desk's own look. Held upright it sits under the
 * screen; sideways it splits left and right of it. The site on the screen takes its presses as
 * it does on the handheld (handheldPad.ts).
 */
export function PhonePad({ send, self, onLeanBack }: { send: Send; self: Self | null; onLeanBack: () => void }) {
  const fullscreen = useFullscreen();
  const buzz = () => navigator.vibrate?.(8);
  const padK = usePadScale();
  return (
    <div className={styles.pad} style={{ '--pad-k': padK } as CSSProperties} onContextMenu={(event) => event.preventDefault()}>
      <button type="button" className={`${styles.leanBack} px-notch`} onClick={onLeanBack}>
        Lean back
      </button>
      <div className={styles.system}>
        {fullscreen.supported && (
          <span className={styles.keySlot} data-key="select">
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
          </span>
        )}
        <PadKey button="start" caption="Start" className={styles.pill} ariaLabel="Start: pause menu" send={send} buzz={buzz} skin={styles} pill />
      </div>

      <div className={styles.dpadSlot}>
        <DPad send={send} buzz={buzz} skin={styles} />
      </div>

      <div className={styles.actions} role="group" aria-label="Actions">
        <SpecialStick send={send} buzz={buzz} self={self} skin={styles} />
        <PadKey button="b" label="B" caption="Attack" className={`${styles.round} ${styles.keyB}`} send={send} buzz={buzz} skin={styles} />
        <PadKey button="a" label="A" caption="Jump" className={`${styles.round} ${styles.keyA}`} send={send} buzz={buzz} skin={styles} />
      </div>
    </div>
  );
}

/** CSS px the pad covers on each side of the window: the screen fits in what is left. */
export function phonePadInset(): { top: number; right: number; bottom: number; left: number } {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const k = padScale();
  if (h >= w) return { top: Math.round(16 + 48 * k), right: 8, bottom: Math.min(Math.round(340 * k), Math.round(h * 0.46)), left: 8 };
  const side = Math.min(Math.round(196 * k), Math.round(w * 0.25));
  return { top: 8, right: side, bottom: 8, left: side };
}
