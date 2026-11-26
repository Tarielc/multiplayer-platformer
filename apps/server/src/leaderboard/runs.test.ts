import { describe, expect, it } from 'vitest';
import { campaignChecksum, entrantKey } from './runs';

describe('leaderboard runs', () => {
  it('keys entrants by lowercased name, team members in any order', () => {
    expect(entrantKey(['Moss'])).toBe('moss');
    expect(entrantKey([' Moss ', 'fern'])).toBe(entrantKey(['FERN', 'moss']));
    expect(entrantKey(['Moss', 'Fern'])).toBe('fern+moss');
  });

  it('checksums a campaign by its levels, in order', () => {
    const ab = campaignChecksum(['aaaa', 'bbbb']);
    expect(ab).toMatch(/^[0-9a-f]{8}$/);
    expect(campaignChecksum(['aaaa', 'bbbb'])).toBe(ab);
    expect(campaignChecksum(['bbbb', 'aaaa'])).not.toBe(ab);
    expect(campaignChecksum(['aaaa', 'bbbc'])).not.toBe(ab);
  });
});
