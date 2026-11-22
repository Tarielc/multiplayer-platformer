import { CHARACTERS, type CharacterId } from '@platformer/shared';
import type { CSSProperties } from 'react';
import { CHARACTER_ART, CHARACTER_SHEET, CLIPS, clipDurationMs } from '@/game/characters/characterArt';
import { DEFAULT_ASSET_BASE } from '@/game/services';
import styles from './CharacterPortrait.module.css';

const SHEET_URL = `${DEFAULT_ASSET_BASE}/${CHARACTER_SHEET.path}`;
/** The body sits in the middle 32×32 of each 64×32 frame. */
const CROP = 32;

/**
 * A character's idle frame(s) as a CSS sprite: the same sheet Phaser uses, cropped to the
 * body and scaled with crisp pixels. `animated` loops the Idle clip (off under reduced motion).
 */
export function CharacterPortrait({
  characterId,
  scale = 2,
  animated = false,
  className,
}: {
  characterId: CharacterId;
  scale?: number;
  animated?: boolean;
  className?: string;
}) {
  const { frameWidth, frameHeight, width, height, rowsPerCharacter } = CHARACTER_SHEET;
  const row = CHARACTER_ART[characterId].block * rowsPerCharacter + CLIPS.idle.row;
  const x0 = -((frameWidth - CROP) / 2) * scale;
  const style = {
    width: CROP * scale,
    height: CROP * scale,
    backgroundImage: `url(${SHEET_URL})`,
    backgroundSize: `${width * scale}px ${height * scale}px`,
    backgroundPosition: `${x0}px ${-row * frameHeight * scale}px`,
    '--x0': `${x0}px`,
    '--strip': `${CLIPS.idle.frames * frameWidth * scale}px`,
    '--frames': CLIPS.idle.frames,
    '--duration': `${clipDurationMs('idle')}ms`,
  } as CSSProperties;
  const name = CHARACTERS[characterId].name;
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={[styles.portrait, className].filter(Boolean).join(' ')}
      data-animated={animated}
      style={style}
    />
  );
}
