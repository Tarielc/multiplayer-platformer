/** Race time as `m:ss.t` (or `s.t s` under a minute). */
export function formatRaceTime(ms: number): string {
  const tenths = Math.floor(ms / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = (tenths % 600) / 10;
  if (minutes === 0) return `${seconds.toFixed(1)} s`;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}
