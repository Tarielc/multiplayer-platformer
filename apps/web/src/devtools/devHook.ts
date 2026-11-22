import { liveGameCount } from '@/game/registry';
import { liveSocketCount } from '@/net/GameClient';

type Provider = () => Record<string, unknown>;

export interface PlatformerDevHook {
  /** Everything registered providers expose, plus live socket/game/canvas counts. */
  snapshot(): Record<string, unknown>;
  /** Virtual buttons OR-ed into local input (Button bitmask) — for automated checks. */
  hold(buttons: number): void;
  release(): void;
}

declare global {
  interface Window {
    __PLATFORMER__?: PlatformerDevHook;
  }
}

const providers = new Map<string, Provider>();
let virtualButtons = 0;

const enabled = () => process.env.NODE_ENV !== 'production' && typeof window !== 'undefined';

/** Registers a named section of the dev hook. Returns an unregister function. No-op in production. */
export function registerDevProvider(name: string, provider: Provider): () => void {
  if (!enabled()) return () => {};
  install();
  providers.set(name, provider);
  return () => {
    if (providers.get(name) === provider) providers.delete(name);
  };
}

/** Buttons held through the dev hook (0 in production). */
export function devVirtualButtons(): number {
  return virtualButtons;
}

function install(): void {
  if (window.__PLATFORMER__) return;
  window.__PLATFORMER__ = {
    snapshot() {
      const out: Record<string, unknown> = {
        sockets: liveSocketCount(),
        games: liveGameCount(),
        canvases: document.querySelectorAll('canvas').length,
      };
      for (const [name, provider] of providers) out[name] = provider();
      return out;
    },
    hold(buttons: number) {
      virtualButtons = buttons | 0;
    },
    release() {
      virtualButtons = 0;
    },
  };
}
