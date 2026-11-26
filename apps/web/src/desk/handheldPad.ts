'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { TouchInput } from '@/game/input/TouchInput';
import type { HudAbility, HudPlayer } from '@/net/RoomStore';

/**
 * The phone handheld (desk/HandheldShell) runs the site in an iframe on its screen and sends its
 * button presses in as messages. This side (inside the iframe) turns them into touch input.
 */
export type PadButton = 'left' | 'right' | 'up' | 'down' | 'a' | 'b' | 's' | 'start';

export interface PadMessage {
  type: 'overgrown:pad';
  button: PadButton;
  down: boolean;
  /** The S thumbstick's aim (-1..1 each, y down): sent again on every move while it is held. */
  x?: number;
  y?: number;
  /** The browser took the thumb away (system gesture): let go without firing. */
  cancel?: boolean;
}

export const isPadMessage = (data: unknown): data is PadMessage =>
  typeof data === 'object' && data !== null && (data as PadMessage).type === 'overgrown:pad';

/**
 * Sent up to the handheld while a game runs on its screen: it shapes the screen to 16:9 and shows
 * your ability (with its recharge ring) on the S thumbstick.
 */
export interface ScreenMessage {
  type: 'overgrown:screen';
  inGame: boolean;
  self?: { characterId: HudPlayer['characterId']; ability: HudAbility } | null;
}

export const isScreenMessage = (data: unknown): data is ScreenMessage =>
  typeof data === 'object' && data !== null && (data as ScreenMessage).type === 'overgrown:screen';

/** Whether this page runs on the handheld's screen (an iframe whose page set `data-shell`). */
export function inHandheld(): boolean {
  if (typeof window === 'undefined' || window.self === window.top) return false;
  try {
    return window.parent.document.documentElement.dataset.shell === 'handheld';
  } catch {
    return false;
  }
}

const noSubscribe = () => () => {};

export function useInHandheld(): boolean {
  return useSyncExternalStore(noSubscribe, inHandheld, () => false);
}

/**
 * While the game runs on the handheld: D-pad walks, A jumps, B swings, the S thumbstick aims the
 * special and uses it when let go (straight ahead from its centre), START toggles the pause menu.
 * With a menu open the pad steers it instead (see steerDialog).
 */
export function useHandheldPad(touch: TouchInput, toggleMenu: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const held = new Set<PadButton>();
    const stick = () => ({
      x: (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0),
      y: (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0),
    });
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin || !isPadMessage(event.data)) return;
      const { button, down } = event.data;
      const was = held.has(button);
      // The thumbstick reports its aim while held: a "down" again is a move.
      if (button === 's' && down && was) {
        touch.dragSpecial(event.data.x ?? 0, event.data.y ?? 0);
        return;
      }
      if (down === was) return;
      if (down) held.add(button);
      else held.delete(button);
      if (down && button !== 'start' && steerDialog(button, toggleMenu)) return;
      const { x, y } = stick();
      switch (button) {
        case 'a':
          if (down) touch.pressJump();
          else touch.releaseJump();
          break;
        case 'b':
          if (down) touch.releaseAttack(0);
          break;
        case 's': {
          const aimX = event.data.x ?? 0;
          const aimY = event.data.y ?? 0;
          if (down) touch.dragSpecial(aimX, aimY);
          else if (event.data.cancel) touch.cancelSpecial();
          else touch.releaseSpecial(aimX, aimY);
          break;
        }
        case 'start':
          if (down) toggleMenu();
          break;
        default:
          if (x || y) touch.setWalk(x, y);
          else touch.releaseWalk();
      }
    };
    window.addEventListener('message', onMessage);
    // The game's own CSS drops the room bar and the stage rim here (html[data-handheld]).
    const root = document.documentElement;
    root.dataset.handheld = '';
    const tell = (inGame: boolean) => {
      const message: ScreenMessage = { type: 'overgrown:screen', inGame };
      window.parent.postMessage(message, window.location.origin);
    };
    tell(true);
    // A reload skips the cleanup below.
    const onPageHide = () => tell(false);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('pagehide', onPageHide);
      delete root.dataset.handheld;
      tell(false);
      touch.reset();
    };
  }, [touch, toggleMenu, enabled]);
}

/** Keeps the handheld's S thumbstick showing your ability and its recharge. */
export function useHandheldAbility(self: HudPlayer | undefined, enabled: boolean): void {
  const ability = self?.ability;
  const characterId = self?.characterId;
  const key = ability && characterId ? `${characterId}|${JSON.stringify(ability)}` : '';
  useEffect(() => {
    if (!enabled) return;
    const message: ScreenMessage = {
      type: 'overgrown:screen',
      inGame: true,
      self: ability && characterId ? { characterId, ability } : null,
    };
    window.parent.postMessage(message, window.location.origin);
    // `key` stands for the ability's contents (its object is new on every HUD update).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
}

/**
 * With a menu open on the screen (any modal dialog), the D-pad moves the highlight (focus), left /
 * right nudge a slider, A presses the highlighted item and B backs out. False when no menu is open.
 */
function steerDialog(button: PadButton, back: () => void): boolean {
  const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
  if (!dialog) return false;
  const items = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]')].filter(
    (el) => el.getClientRects().length > 0,
  );
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const at = active ? items.indexOf(active) : -1;
  switch (button) {
    case 'up':
    case 'down': {
      if (!items.length) break;
      const step = button === 'down' ? 1 : -1;
      const next = items[at < 0 ? 0 : (at + step + items.length) % items.length];
      next?.focus({ preventScroll: true });
      next?.scrollIntoView({ block: 'nearest' });
      break;
    }
    case 'left':
    case 'right':
      if (active instanceof HTMLInputElement && active.type === 'range') {
        if (button === 'right') active.stepUp();
        else active.stepDown();
        active.dispatchEvent(new Event('input', { bubbles: true }));
      }
      break;
    case 'a':
      if (at >= 0) items[at]?.click();
      else items[0]?.focus({ preventScroll: true });
      break;
    case 'b':
      back();
      break;
  }
  return true;
}
