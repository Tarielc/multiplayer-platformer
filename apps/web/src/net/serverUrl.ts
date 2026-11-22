/** Default game-server port when NEXT_PUBLIC_GAME_SERVER_URL is not set. */
export const DEFAULT_GAME_SERVER_PORT = 3001;

/**
 * HTTP base URL of the game server. Uses NEXT_PUBLIC_GAME_SERVER_URL when set, otherwise the
 * page's own hostname on port 3001, so LAN play (http://192.168.x.y:3000) works without config.
 */
export function gameServerHttpUrl(): string {
  const configured = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
  if (configured) return configured.replace(/\/+$/, '');
  if (typeof window === 'undefined') return `http://localhost:${DEFAULT_GAME_SERVER_PORT}`;
  return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_GAME_SERVER_PORT}`;
}

export function gameServerWsUrl(): string {
  return `${gameServerHttpUrl().replace(/^http/, 'ws')}/ws`;
}
