'use client';

import type { CharacterId } from '@platformer/shared';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { abilityIconPath } from '@/game/abilities/abilityArt';
import { DEFAULT_ASSET_BASE } from '@/game/services';
import { GAME_TITLE } from '@/components/brand';
import type { ServerState } from '@/hooks/useHomeActions';
import type { ScreenKind } from './screenEnv';
import { OnlineStatus } from './ScreenStage';
import s from './screens.module.css';

/**
 * Something to click or tap on a screen. It never takes focus, so the keys and the pad keep
 * driving the screen's own cursor (Enter means the cursor's item, not the last click); and it is
 * not a <button>, so the site's stone button look stays out of the way.
 */
export function Btn({
  className,
  children,
  disabled = false,
  onClick,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { disabled?: boolean }) {
  return (
    <div
      role="button"
      aria-disabled={disabled || undefined}
      className={[s.bare, className].filter(Boolean).join(' ')}
      onMouseDown={(event) => event.preventDefault()}
      onClick={disabled ? undefined : onClick}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface MenuItem {
  id: string;
  label: string;
  sub?: string;
  disabled?: boolean;
}

/** A list you move a cursor through: ↑ ↓ (or hover) to choose, Enter (or click) to pick. */
export function Menu({
  items,
  index,
  onIndex,
  onPick,
  className,
  style,
}: {
  items: readonly MenuItem[];
  index: number;
  onIndex: (index: number) => void;
  onPick: (index: number) => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={[s.menu, className].filter(Boolean).join(' ')} style={style} role="menu">
      {items.map((item, i) => (
        <Btn
          key={item.id}
          role="menuitem"
          className={s.item}
          data-on={i === index}
          aria-current={i === index}
          disabled={item.disabled}
          onMouseEnter={() => onIndex(i)}
          onClick={() => onPick(i)}
        >
          <span className={s.cur} aria-hidden />
          {item.label}
          {item.sub && <span className={s.sub}>{item.sub}</span>}
        </Btn>
      ))}
    </div>
  );
}

/** The game's name with its second half in moss green. */
export function Logo({ className, style }: { className?: string; style?: CSSProperties }) {
  const cut = GAME_TITLE.toLowerCase().startsWith('over') ? 4 : Math.ceil(GAME_TITLE.length / 2);
  return (
    <h1 className={[s.logo, className].filter(Boolean).join(' ')} style={style}>
      {GAME_TITLE.slice(0, cut)}
      <i>{GAME_TITLE.slice(cut)}</i>
    </h1>
  );
}

/** A character's special-ability icon in a gold-rimmed tile. */
export function AbilityTile({ characterId, size, className }: { characterId: CharacterId; size: number; className?: string }) {
  const icon = Math.round((size * 2) / 3);
  return (
    <span className={[s.badge, className].filter(Boolean).join(' ')} style={{ width: size, height: size }}>
      <img src={`${DEFAULT_ASSET_BASE}/${abilityIconPath(characterId)}`} alt="" width={icon} height={icon} draggable={false} />
    </span>
  );
}

/** The server line for the status bar. */
export function ServerStatusLine({ server, kind }: { server: ServerState; kind: ScreenKind }) {
  if (server.kind === 'checking') return <OnlineStatus state="wait">Connecting…</OnlineStatus>;
  if (server.kind === 'offline') return <OnlineStatus state="down">Server offline</OnlineStatus>;
  const { rooms, connectedPlayers } = server.health;
  const playing = `${connectedPlayers} playing`;
  if (kind === 'pocket') return <OnlineStatus state="ok">{playing}</OnlineStatus>;
  return (
    <>
      <OnlineStatus state="ok">Online</OnlineStatus>
      <span>
        {rooms} room{rooms === 1 ? '' : 's'} · {playing}
      </span>
    </>
  );
}

/** Crumb trail for the status bar: Overgrown ▸ Characters. */
export function Crumb({ children }: { children?: ReactNode }) {
  return (
    <>
      {GAME_TITLE}
      {children && (
        <>
          {' '}
          <b>▸</b> {children}
        </>
      )}
    </>
  );
}
