import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPlayerName, savePlayerName } from './identity';

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('window', {});
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const RANDOM = /^[A-Z][a-z]+[A-Z][a-z]+\d{2}$/;

describe('player name identity', () => {
  it('gives a first-time visitor a random name and keeps it', () => {
    const first = loadPlayerName();
    expect(first).toMatch(RANDOM);
    expect(loadPlayerName()).toBe(first);
    expect(storage.getItem('platformer.playerName')).toBe(first);
  });

  it('gives different browsers different names', () => {
    const names = new Set<string>();
    for (let i = 0; i < 50; i++) {
      storage = new MemoryStorage();
      vi.stubGlobal('localStorage', storage);
      names.add(loadPlayerName());
    }
    expect(names.size).toBeGreaterThan(45);
  });

  it('replaces the old "Player" default but keeps a name someone typed before', () => {
    storage.setItem('platformer.name', 'Player');
    expect(loadPlayerName()).toMatch(RANDOM);
    expect(storage.getItem('platformer.name')).toBeNull();

    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem('platformer.name', 'Moss Queen');
    expect(loadPlayerName()).toBe('Moss Queen');
  });

  it('saves typed names, even "Player", and keeps the current one when the field is cleared', () => {
    const random = loadPlayerName();
    expect(savePlayerName('   ')).toBe(random);
    expect(savePlayerName('  Fern  ')).toBe('Fern');
    expect(savePlayerName('Player')).toBe('Player');
    expect(loadPlayerName()).toBe('Player');
  });
});
