'use client';

import type { CharacterId } from '@platformer/shared';
import type { CSSProperties, ReactNode } from 'react';
import { abilityIconPath } from '@/game/abilities/abilityArt';
import { DEFAULT_ASSET_BASE } from '@/game/services';
import { useTouchDevice } from '@/hooks/useTouchDevice';
import type { HudAbility, HudPlayer } from '@/net/RoomStore';
import styles from './AbilityBadge.module.css';

/**
 * A special ability's icon in a notched stone frame whose gold ring fills as it recharges: the
 * seconds left on top while it cools down, solid gold (and a slow glow) once it is ready, moss
 * while in use (draining, with the seconds left, when the use is timed: the drone's battery,
 * giant form), and a flash each time fruit tops it up. `size`: `chip` (teammate chips),
 * `button` (your own, large), `fill` (fills its parent, e.g. the touch special button).
 * `symbol` stands in for the ability's sprite (the phone controls show the button's own mark),
 * hidden while seconds count down.
 */
export function AbilityBadge({
  characterId,
  ability,
  size,
  symbol,
}: {
  characterId: CharacterId;
  ability: HudAbility;
  size: 'chip' | 'button' | 'fill';
  symbol?: ReactNode;
}) {
  const { name, cooldown, charge, active, left, refills } = ability;
  const ready = cooldown <= 0;
  // The seconds on the face: time left in use, or until it is ready again.
  const timed = active && left > 0;
  const seconds = timed ? Math.ceil(left) : !ready && !active ? Math.ceil(cooldown) : 0;
  const label = active
    ? `${name} (active${timed ? `, ${left.toFixed(1)} s left` : ''})`
    : ready
      ? `${name} (ready)`
      : `${name} (${cooldown.toFixed(1)} s)`;
  const style = { '--charge': `${Math.round(charge * 360)}deg` } as CSSProperties;
  return (
    <span
      className={styles.badge}
      data-size={size}
      data-ready={ready}
      data-active={active}
      data-counting={seconds > 0}
      style={style}
      title={label}
      aria-label={label}
      role="img"
    >
      <span className={`${styles.frame} px-notch`}>
        <span className={`${styles.ring} px-notch`}>
          <span className={`${styles.face} px-notch`}>
            {symbol === undefined ? (
              <img src={`${DEFAULT_ASSET_BASE}/${abilityIconPath(characterId)}`} alt="" draggable={false} />
            ) : (
              seconds === 0 && <span className={styles.symbol}>{symbol}</span>
            )}
            {seconds > 0 && <span className={`${styles.seconds} px-outline`}>{seconds}</span>}
          </span>
        </span>
      </span>
      {/* Remounts on every refill, replaying the flash once. */}
      {refills > 0 && <span key={refills} className={`${styles.flash} px-notch`} aria-hidden />}
    </span>
  );
}

/**
 * Your own ability, large, in the bottom-left corner of the stage, with its state, name and keys.
 * Touch devices skip it: their special button shows the same badge.
 */
export function AbilityButton({ self }: { self: HudPlayer | undefined }) {
  const touch = useTouchDevice();
  if (!self || touch) return null;
  const { active, cooldown, name } = self.ability;
  const state = active ? 'active' : cooldown <= 0 ? 'ready' : 'charging';
  return (
    <div className={styles.button} data-state={state}>
      <AbilityBadge characterId={self.characterId} ability={self.ability} size="button" />
      <span className={styles.caption}>
        <span className={`${styles.state} px-outline-sm`}>
          {state === 'active' ? 'In use' : state === 'ready' ? 'Ready' : 'Recharging · fruit & foes help'}
        </span>
        <span className={`${styles.name} px-outline`}>{name}</span>
        <span className={styles.keys}>
          <kbd>L</kbd>
          <kbd>C</kbd>
          <kbd title="Right mouse button">RMB</kbd>
        </span>
      </span>
    </div>
  );
}
