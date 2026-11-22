// Phaser-free bookkeeping, importable from React code without pulling Phaser into SSR.

let liveGames = 0;

export function trackGameCreated(): void {
  liveGames += 1;
}

export function trackGameDestroyed(): void {
  liveGames = Math.max(0, liveGames - 1);
}

/** Number of Phaser.Game instances currently alive (should never exceed 1). */
export function liveGameCount(): number {
  return liveGames;
}
