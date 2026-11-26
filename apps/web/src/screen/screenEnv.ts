'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { isPadMessage, type PadButton } from '@/desk/handheldPad';

/**
 * Where the site runs when it is on a screen of its own: `crt` (the desk's computer, played with
 * a keyboard and mouse) or `pocket` (the phone handheld, played with its pad and the touchscreen).
 * Null for the plain site (no frame around it).
 */
export type ScreenKind = 'crt' | 'pocket';

export function screenKind(): ScreenKind | null {
  if (typeof window === 'undefined' || window.self === window.top) return null;
  try {
    return window.parent.document.documentElement.dataset.shell === 'handheld' ? 'pocket' : 'crt';
  } catch {
    return null;
  }
}

const noSubscribe = () => () => {};
const serverKind = () => null;

/** Decided once per page: the frame around the site does not change. */
export function useScreenKind(): ScreenKind | null {
  return useSyncExternalStore(noSubscribe, screenKind, serverKind);
}

/** What a screen reacts to: the same for keys, the pad and (through buttons) the mouse. */
export type ScreenAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';

const KEY_ACTIONS: Record<string, ScreenAction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
  Enter: 'confirm',
  ' ': 'confirm',
  Escape: 'back',
  Backspace: 'back',
};

/** In a text field these keys belong to the field (typing, moving the caret, deleting). */
const FIELD_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Backspace', ' ', 'w', 's', 'a', 'd', 'W', 'S', 'A', 'D']);

/**
 * Calls `onAction` for the screen's keys (arrows / WASD, Enter / Space, Esc / Backspace). In a
 * text field, typing keys stay with the field: only ↑ ↓, Enter and Esc reach the screen.
 * `onKey` sees every other key (letter shortcuts).
 */
export function useScreenKeys(onAction: (action: ScreenAction, event: KeyboardEvent) => void, onKey?: (event: KeyboardEvent) => void): void {
  const ref = useRef({ onAction, onKey });
  useEffect(() => {
    ref.current = { onAction, onKey };
  });
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      const inField = target instanceof HTMLInputElement && target.type !== 'range' && target.type !== 'checkbox';
      if (inField && FIELD_KEYS.has(event.key)) return;
      const action = KEY_ACTIONS[event.key];
      if (action) {
        // Space and Enter on a focused button already click it.
        if (action === 'confirm' && target instanceof HTMLButtonElement && event.isTrusted) return;
        event.preventDefault();
        ref.current.onAction(action, event);
      } else if (!inField) {
        ref.current.onKey?.(event);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
}

const PAD_KEYS: Partial<Record<PadButton, string>> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  a: 'Enter',
  start: 'Enter',
  b: 'Escape',
};
const REPEAT_DELAY = 380;
const REPEAT_EVERY = 130;

/**
 * On the pocket handheld, outside a game: its pad presses arrive as messages (handheldPad.ts) and
 * are replayed here as key presses, so every screen is driven the same way. A held D-pad repeats.
 */
export function usePadAsKeys(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const timers = new Map<PadButton, ReturnType<typeof setTimeout>>();
    const press = (key: string) => {
      const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
      target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    };
    const stop = (button: PadButton) => {
      clearTimeout(timers.get(button));
      timers.delete(button);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin || !isPadMessage(event.data)) return;
      const { button, down } = event.data;
      const key = PAD_KEYS[button];
      if (!key) return;
      if (!down) return stop(button);
      if (timers.has(button)) return;
      press(key);
      if (!key.startsWith('Arrow')) {
        timers.set(button, setTimeout(() => undefined, 0));
        return;
      }
      const repeat = () => {
        press(key);
        timers.set(button, setTimeout(repeat, REPEAT_EVERY));
      };
      timers.set(button, setTimeout(repeat, REPEAT_DELAY));
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      for (const button of [...timers.keys()]) stop(button);
    };
  }, [enabled]);
}
