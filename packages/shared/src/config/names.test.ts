import { describe, expect, it } from 'vitest';
import { sanitizePlayerName } from '../protocol/validate';
import { NAME_ADJECTIVES, NAME_CREATURES, randomPlayerName } from './names';
import { PLAYER_CONFIG } from './players';

describe('random player names', () => {
  it('every combination fits the name limit and survives sanitizing unchanged', () => {
    const longest = Math.max(...NAME_ADJECTIVES.map((a) => a.length)) + Math.max(...NAME_CREATURES.map((c) => c.length)) + 2;
    expect(longest).toBeLessThanOrEqual(PLAYER_CONFIG.nameMaxLength);
    for (let i = 0; i < 200; i++) {
      const name = randomPlayerName();
      expect(name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+[1-9][0-9]$/);
      expect(sanitizePlayerName(name)).toBe(name);
    }
  });

  it('covers the whole word lists and number range, never the old default', () => {
    expect(randomPlayerName(() => 0)).toBe(`${NAME_ADJECTIVES[0]}${NAME_CREATURES[0]}10`);
    expect(randomPlayerName(() => 0.999999)).toBe(`${NAME_ADJECTIVES.at(-1)}${NAME_CREATURES.at(-1)}99`);
    expect(new Set(NAME_ADJECTIVES).size).toBe(NAME_ADJECTIVES.length);
    expect(new Set(NAME_CREATURES).size).toBe(NAME_CREATURES.length);
  });

  it('rarely repeats', () => {
    const names = new Set(Array.from({ length: 1000 }, () => randomPlayerName()));
    expect(names.size).toBeGreaterThan(990);
    expect(names.has(PLAYER_CONFIG.defaultName)).toBe(false);
  });
});
