import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, CHARACTERS, defaultCharacterForSlot, isCharacterId, pickFreeCharacter } from './characters';
import { MAX_PLAYERS } from './players';

describe('characters', () => {
  it('has a unique default for every player slot', () => {
    const defaults = Array.from({ length: MAX_PLAYERS }, (_, slot) => defaultCharacterForSlot(slot));
    expect(new Set(defaults).size).toBe(MAX_PLAYERS);
    expect(defaults[0]).toBe('bunny-man');
    expect(defaults[3]).toBe('ninja-frog');
  });

  it('describes every id', () => {
    for (const id of CHARACTER_IDS) expect(CHARACTERS[id].id).toBe(id);
    expect(isCharacterId('mask-dude')).toBe(true);
    expect(isCharacterId('pink-man')).toBe(false);
    expect(isCharacterId(undefined)).toBe(false);
  });

  it('keeps a free preference, otherwise takes the next free character in roster order', () => {
    expect(pickFreeCharacter('mask-dude', ['bunny-man'])).toBe('mask-dude');
    expect(pickFreeCharacter('mask-dude', ['mask-dude'])).toBe('ninja-frog');
    expect(pickFreeCharacter('ninja-frog', ['ninja-frog', 'bunny-man'])).toBe('virtual-guy'); // wraps
    expect(pickFreeCharacter('bunny-man', CHARACTER_IDS)).toBe('bunny-man'); // all taken
  });
});
