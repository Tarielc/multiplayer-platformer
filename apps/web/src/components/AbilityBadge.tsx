'use client';

import type { CharacterId } from '@platformer/shared';
import type { CSSProperties } from 'react';
import { abilityIconPath } from '@/game/abilities/abilityArt';
import { DEFAULT_ASSET_BASE } from '@/game/services';
import { useTouchDevice } from '@/hooks/useTouchDevice';
import type { HudAbility, HudPlayer } from '@/net/RoomStore';
import styles from './AbilityBadge.module.css';

/**
 * A special ability's icon in a ring that fills as it recharges: the seconds left on top while
 * it cools down, a glow (and a slow pulse) once it is ready, an outline while in use, and a
 * flash each time fruit tops it up. `size`: `chip` (player chips), `button` (your own, large),
 * `fill` (fills its parent, e.g. the touch special button).
 */
export function AbilityBadge({
  characterId,
  ability,
  color,
  size,
}: {
  characterId: CharacterId;
  ability: HudAbility;
  color: string;
  size: 'chip' | 'button' | 'fill';
}) {
  const { name, cooldown, charge, active, refills } = ability;
  const ready = cooldown <= 0;
  const label = active ? `${name} (active)` : ready ? `${name} (ready)` : `${name} (${cooldown.toFixed(1)} s)`;
  const style = { '--slot': color, '--charge': `${Math.round(charge * 360)}deg` } as CSSProperties;
  return (
    <span
      className={styles.badge}
      data-size={size}
      data-ready={ready}
      data-active={active}
      style={style}
      title={label}
      aria-label={label}
      role="img"
    >
      <span className={styles.face}>
        <img src={`${DEFAULT_ASSET_BASE}/${abilityIconPath(characterId)}`} alt="" draggable={false} />
        {!ready && !active && <span className={styles.seconds}>{Math.ceil(cooldown)}</span>}
      </span>
      {/* Remounts on every refill, replaying the flash once. */}
      {refills > 0 && <span key={refills} className={styles.flash} aria-hidden />}
    </span>
  );
}

/**
 * Your own ability, large, in the bottom-left corner of the stage, with its name and keys.
 * Touch devices skip it: their special button shows the same badge.
 */
export function AbilityButton({ self }: { self: HudPlayer | undefined }) {
  const touch = useTouchDevice();
  if (!self || touch) return null;
  const ready = self.ability.cooldown <= 0;
  return (
    <div className={styles.button} data-ready={ready && !self.ability.active}>
      <AbilityBadge characterId={self.characterId} ability={self.ability} color={self.color} size="button" />
      <span className={styles.caption}>
        <span className={styles.name}>{self.ability.name}</span>
        <span className={styles.keys}>
          <kbd>L</kbd> <kbd>C</kbd> right-click
        </span>
      </span>
    </div>
  );
}
