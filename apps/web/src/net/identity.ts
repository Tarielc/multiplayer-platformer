import { PLAYER_CONFIG, sanitizePlayerName } from '@platformer/shared';

const CLIENT_ID_KEY = 'platformer.clientId';
const NAME_KEY = 'platformer.name';
const CHANNEL = 'platformer.clientId';
const CLAIM_TIMEOUT_MS = 60;

let claim: Promise<string> | null = null;

/**
 * 128 random bits as hex. Uses getRandomValues rather than randomUUID: randomUUID only exists
 * in secure contexts, and LAN play over plain http (http://192.168.x.x:3000) is not one.
 */
function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Per-tab secret used to re-attach to the same player slot after a refresh or reconnect.
 * Lives in sessionStorage (survives reloads, not shared between tabs). Browsers copy
 * sessionStorage when a tab is *duplicated*, so we ask other tabs over a BroadcastChannel
 * whether the id is already in use and mint a new one if it is.
 */
export function getClientId(): Promise<string> {
  claim ??= claimClientId();
  return claim;
}

async function claimClientId(): Promise<string> {
  let id = sessionStorage.getItem(CLIENT_ID_KEY) ?? randomId();
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL);
    const taken = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), CLAIM_TIMEOUT_MS);
      channel.onmessage = (event: MessageEvent<{ type: string; id: string }>) => {
        if (event.data?.type === 'taken' && event.data.id === id) {
          clearTimeout(timer);
          resolve(true);
        }
      };
      channel.postMessage({ type: 'query', id });
    });
    if (taken) id = randomId();
    // Answer future duplicates of this tab for as long as the page lives.
    channel.onmessage = (event: MessageEvent<{ type: string; id: string }>) => {
      if (event.data?.type === 'query' && event.data.id === id) channel.postMessage({ type: 'taken', id });
    };
  }
  sessionStorage.setItem(CLIENT_ID_KEY, id);
  return id;
}

export function loadPlayerName(): string {
  if (typeof window === 'undefined') return PLAYER_CONFIG.defaultName;
  return sanitizePlayerName(localStorage.getItem(NAME_KEY) ?? '');
}

export function savePlayerName(name: string): string {
  const clean = sanitizePlayerName(name);
  localStorage.setItem(NAME_KEY, clean);
  return clean;
}
