import type { LeaderboardEntry } from '@platformer/shared';
import { CharacterPortrait } from './CharacterPortrait';
import { formatRaceTime } from './format';
import styles from './LeaderboardTable.module.css';

/**
 * One leaderboard: rank, who (portraits + names), how many played, time. `size` picks the
 * density: `page` for the plain site, `crt` / `pocket` for the retro screens.
 */
export function LeaderboardTable({
  entries,
  size = 'page',
  you,
  emptyText = 'No times yet. Be the first!',
}: {
  entries: readonly LeaderboardEntry[];
  size?: 'page' | 'crt' | 'pocket';
  /** Highlights rows that include this name (case-insensitive). */
  you?: string;
  emptyText?: string;
}) {
  if (entries.length === 0) return <p className={styles.empty} data-size={size}>{emptyText}</p>;
  const me = you?.trim().toLowerCase();
  const portraitScale = size === 'page' ? 2 : 1;
  return (
    <ol className={styles.board} data-size={size}>
      {entries.map((entry) => (
        <li
          key={`${entry.rank}-${entry.names.join('+')}`}
          className={styles.row}
          data-rank={entry.rank <= 3 ? entry.rank : undefined}
          data-you={me ? entry.names.some((n) => n.toLowerCase() === me) : undefined}
        >
          <span className={styles.rank}>{entry.rank}</span>
          <span className={styles.who}>
            {size !== 'pocket' && (
              <span className={styles.portraits} aria-hidden>
                {entry.characters.map((id, i) => (
                  <CharacterPortrait key={i} characterId={id} scale={portraitScale} />
                ))}
              </span>
            )}
            <span className={styles.names}>{entry.names.join(' · ')}</span>
          </span>
          <span className={styles.players} title={entry.playerCount === 1 ? 'Played solo' : `${entry.playerCount} players in the room`}>
            {entry.playerCount === 1 ? 'Solo' : `${entry.playerCount}P`}
          </span>
          <span className={styles.time}>{formatRaceTime(entry.timeMs)}</span>
        </li>
      ))}
    </ol>
  );
}
