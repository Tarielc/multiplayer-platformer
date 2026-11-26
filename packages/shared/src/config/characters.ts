/**
 * Playable character roster. The ids are part of the wire protocol (lobby picks) and must stay
 * stable; display art lives on the client (`apps/web/src/game/characters/characterArt.ts`).
 *
 * To add a character: append an id here, add its art entry on the client and a block of rows
 * to the sprite sheet. Order is the pickers' order and sets the defaults (`defaultCharacterForSlot`):
 * the first is a new player's character. Sprite rows don't depend on it (`CHARACTER_ART[id].block`).
 */
export const CHARACTER_IDS = ['ninja-frog', 'bunny-man', 'virtual-guy', 'mask-dude'] as const;

export type CharacterId = (typeof CHARACTER_IDS)[number];

export interface CharacterInfo {
  id: CharacterId;
  name: string;
}

export const CHARACTERS: Readonly<Record<CharacterId, CharacterInfo>> = {
  'bunny-man': { id: 'bunny-man', name: 'Bunny Man' },
  'virtual-guy': { id: 'virtual-guy', name: 'Virtual Guy' },
  'mask-dude': { id: 'mask-dude', name: 'Mask Dude' },
  'ninja-frog': { id: 'ninja-frog', name: 'Ninja Frog' },
};

export function isCharacterId(value: unknown): value is CharacterId {
  return typeof value === 'string' && (CHARACTER_IDS as readonly string[]).includes(value);
}

export function characterInfo(id: CharacterId): CharacterInfo {
  return CHARACTERS[id];
}

/** P1 → Ninja Frog, P2 → Bunny Man, … (wraps if there are more slots than characters). */
export function defaultCharacterForSlot(slot: number): CharacterId {
  const n = CHARACTER_IDS.length;
  return CHARACTER_IDS[((slot % n) + n) % n]!;
}

/**
 * `preferred` if nobody else has it, otherwise the next free character in roster order
 * (wrapping). Falls back to `preferred` when every character is taken (more players than
 * characters), so duplicates are possible only then.
 */
export function pickFreeCharacter(preferred: CharacterId, taken: Iterable<CharacterId>): CharacterId {
  const used = new Set(taken);
  if (!used.has(preferred)) return preferred;
  const start = CHARACTER_IDS.indexOf(preferred);
  for (let i = 1; i < CHARACTER_IDS.length; i++) {
    const candidate = CHARACTER_IDS[(start + i) % CHARACTER_IDS.length]!;
    if (!used.has(candidate)) return candidate;
  }
  return preferred;
}
