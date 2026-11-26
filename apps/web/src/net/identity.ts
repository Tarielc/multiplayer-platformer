import { PLAYER_CONFIG, isCharacterId, randomPlayerName, sanitizePlayerName, type CharacterId } from '@platformer/shared';

const CLIENT_ID_KEY = 'platformer.clientId';
const NAME_KEY = 'platformer.playerName';
/** Where names lived before random names: it also held the old "Player" default. */
const LEGACY_NAME_KEY = 'platformer.name';
const CHARACTER_KEY = 'platformer.character';
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

/** [0, 1) from the browser's CSPRNG (Math.random can repeat across fresh tabs on some engines). */
function randomUnit(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
}

/** Cleaned name, or '' when it is missing or blank. */
const clean = (raw: string | null) => (raw === null ? '' : sanitizePlayerName(raw, PLAYER_CONFIG.nameMaxLength, ''));

/**
 * This browser's player name. The first visit gets a random one ("MossyNewt42") and keeps it,
 * so new players aren't all "Player". A name typed before random names existed carries over;
 * the old "Player" default does not.
 */
export function loadPlayerName(): string {
  if (typeof window === 'undefined') return PLAYER_CONFIG.defaultName;
  const saved = clean(localStorage.getItem(NAME_KEY));
  if (saved) return saved;
  const legacy = clean(localStorage.getItem(LEGACY_NAME_KEY));
  localStorage.removeItem(LEGACY_NAME_KEY);
  return savePlayerName(legacy && legacy !== PLAYER_CONFIG.defaultName ? legacy : randomPlayerName(randomUnit));
}

/** Saves a typed name. A blank one keeps the current name (or, failing that, draws a random one). */
export function savePlayerName(name: string): string {
  const next = clean(name) || clean(localStorage.getItem(NAME_KEY)) || randomPlayerName(randomUnit);
  localStorage.setItem(NAME_KEY, next);
  return next;
}

/** The character this browser last picked, or null (then the server uses the slot default). */
export function loadPreferredCharacter(): CharacterId | null {
  if (typeof window === 'undefined') return null;
  const value = localStorage.getItem(CHARACTER_KEY);
  return isCharacterId(value) ? value : null;
}

export function savePreferredCharacter(id: CharacterId): void {
  localStorage.setItem(CHARACTER_KEY, id);
}
