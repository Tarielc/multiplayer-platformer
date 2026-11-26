import { Fnv1a } from '@platformer/shared';

/**
 * Board key for a run: the lowercased name in race, or the sorted lowercased team names in co-op.
 * Each entrant shows up once on a board, with their best time.
 */
export function entrantKey(names: readonly string[]): string {
  return names
    .map((name) => name.trim().toLowerCase())
    .sort()
    .join('+');
}

/** Checksum of a campaign run: the checksums of the levels played, in order. */
export function campaignChecksum(levelChecksums: readonly string[]): string {
  const hash = new Fnv1a().str('campaign');
  for (const checksum of levelChecksums) hash.str(checksum);
  return hash.digest();
}
