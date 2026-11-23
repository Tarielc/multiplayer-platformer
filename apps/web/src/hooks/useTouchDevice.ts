'use client';

import { useSyncExternalStore } from 'react';

const COARSE = '(pointer: coarse)';

/** Set by the first touch on the page, so touch laptops get the touch UI once they are touched. */
let touchSeen = false;

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(COARSE);
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || touchSeen) return;
    touchSeen = true;
    onChange();
  };
  media.addEventListener('change', onChange);
  window.addEventListener('pointerdown', onPointerDown, true);
  return () => {
    media.removeEventListener('change', onChange);
    window.removeEventListener('pointerdown', onPointerDown, true);
  };
}

/** Whether to show touch UI: a touch-first device (coarse pointer), or one the player touched. */
export function useTouchDevice(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => touchSeen || window.matchMedia(COARSE).matches,
    () => false,
  );
}
