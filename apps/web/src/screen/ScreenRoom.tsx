'use client';

import {
  CHARACTER_IDS,
  CHARACTERS,
  GAME_MODES,
  LEVELS,
  MAX_PLAYERS,
  MODE_CONFIG,
  PLAYER_SLOTS,
  scalingSummary,
  type CharacterId,
} from '@platformer/shared';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { abilityName } from '@/components/brand';
import { CharacterPortrait } from '@/components/CharacterPortrait';
import type { GameSession } from '@/hooks/useGameSession';
import { savePreferredCharacter } from '@/net/identity';
import type { RoomView } from '@/net/RoomStore';
import { gameServerHttpUrl } from '@/net/serverUrl';
import { AbilityTile, Btn, Crumb } from './parts';
import { levelTile, MODE_ART } from './ScreenHome';
import { useScreenKeys, type ScreenKind } from './screenEnv';
import { Key, OnlineStatus, PadA, ScreenStage, useStageKind } from './ScreenStage';
import s from './screens.module.css';
import r from './room.module.css';

type Row = 'character' | 'mode' | 'level' | 'ready';
const ROWS: Row[] = ['character', 'mode', 'level', 'ready'];
const wrap = (i: number, n: number) => (i + n) % n;

/**
 * A room on the CRT or the handheld, outside a game: connecting, a fatal error, or the lobby.
 * (In a game the screen is the game itself.)
 */
export function ScreenRoom({ roomId, session, view, onLeave }: { roomId: string; session: GameSession; view: RoomView; onLeave: () => void }) {
  const kind = useStageKind();
  const { room, fatal, status, rttMs } = view;
  const line =
    status === 'open' ? (
      <OnlineStatus state="ok">{rttMs !== null ? `${rttMs} ms` : 'Online'}</OnlineStatus>
    ) : (
      <OnlineStatus state={status === 'reconnecting' || status === 'connecting' ? 'wait' : 'down'}>{status}</OnlineStatus>
    );
  if (fatal) return <RoomMessage kind={kind} roomId={roomId} line={line} fatal={fatal} onRetry={() => session.client.retry()} onLeave={onLeave} />;
  if (!room) return <RoomMessage kind={kind} roomId={roomId} line={line} reconnecting={status === 'reconnecting'} onLeave={onLeave} />;
  return <ScreenLobby kind={kind} session={session} view={view} line={line} onLeave={onLeave} />;
}

function RoomMessage({
  kind,
  roomId,
  line,
  fatal,
  reconnecting = false,
  onRetry,
  onLeave,
}: {
  kind: ScreenKind;
  roomId: string;
  line: ReactNode;
  fatal?: { code: string; message: string };
  reconnecting?: boolean;
  onRetry?: () => void;
  onLeave: () => void;
}) {
  const unreachable = fatal?.code === 'UNREACHABLE';
  useScreenKeys((action) => {
    if (action === 'back') onLeave();
    else if (action === 'confirm') {
      if (unreachable) onRetry?.();
      else if (fatal) onLeave();
    }
  });
  const pocket = kind === 'pocket';
  return (
    <ScreenStage
      label={`Room ${roomId}`}
      crumb={<Crumb>Room {roomId}</Crumb>}
      status={line}
      hints={
        fatal
          ? unreachable
            ? [
                { controls: ['confirm'], label: 'Retry' },
                { controls: ['back'], label: 'Home' },
              ]
            : [{ controls: ['confirm'], label: 'Home' }]
          : [{ controls: ['back'], label: 'Cancel' }]
      }
    >
      <div className={`${s.panel} ${pocket ? r.messagePocket : r.message}`} role={fatal ? 'alert' : 'status'}>
        <div className={r.messageTitle}>
          {fatal ? (unreachable ? 'Connection lost' : "Can't join this room") : reconnecting ? 'Reconnecting…' : 'Connecting…'}
        </div>
        <p className={r.messageText}>{fatal ? fatal.message : `Joining room ${roomId}`}</p>
        {unreachable && <p className={r.messageDim}>Is the game server running at {gameServerHttpUrl()}? Start it with npm run dev.</p>}
        {!fatal && <span className={r.spinner} aria-hidden />}
      </div>
    </ScreenStage>
  );
}

function ScreenLobby({
  kind,
  session,
  view,
  line,
  onLeave,
}: {
  kind: ScreenKind;
  session: GameSession;
  view: RoomView;
  line: ReactNode;
  onLeave: () => void;
}) {
  const room = view.room!;
  const { client } = session;
  const pocket = kind === 'pocket';
  const me = room.players.find((p) => p.id === view.selfId);
  const isHost = me?.isHost ?? false;
  const bySlot = new Map(room.players.map((p) => [p.slot, p]));
  const connected = room.players.filter((p) => p.connected);
  const levels = LEVELS.campaign(room.mode);
  const levelIndex = Math.max(0, levels.findIndex((e) => e.id === room.selectedLevelId));
  const selected = levels[levelIndex];
  const mode = MODE_CONFIG[room.mode];
  const race = room.mode === 'race';
  const tooFew = connected.length < mode.minPlayers;
  const scaling = scalingSummary(room.mode, room.players.length);
  const taken = new Set<CharacterId>(room.players.filter((p) => p.id !== view.selfId).map((p) => p.characterId));
  const waitingOn = connected.filter((p) => !p.ready && p.id !== view.selfId).map((p) => p.name);
  const finalScores = room.campaignComplete ? [...room.players].sort((a, b) => b.campaignScore - a.campaignScore) : [];

  const [row, setRow] = useState<Row>('ready');
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  const inviteUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/room/${room.roomId}`;
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Invite link', inviteUrl);
    }
  };
  const stepCharacter = (delta: number) => {
    if (!me) return;
    let i = CHARACTER_IDS.indexOf(me.characterId);
    for (let tries = 0; tries < CHARACTER_IDS.length; tries++) {
      i = wrap(i + delta, CHARACTER_IDS.length);
      const id = CHARACTER_IDS[i]!;
      if (!taken.has(id)) {
        savePreferredCharacter(id);
        client.selectCharacter(id);
        return;
      }
    }
  };
  const stepMode = (delta: number) => {
    if (!isHost) return;
    const next = GAME_MODES[wrap(GAME_MODES.indexOf(room.mode) + delta, GAME_MODES.length)];
    if (next) client.selectMode(next);
  };
  const stepLevel = (delta: number) => {
    if (!isHost) return;
    const next = levels[wrap(levelIndex + delta, levels.length)];
    if (next) client.selectLevel(next.id);
  };
  const change = (delta: number) => {
    if (row === 'character') stepCharacter(delta);
    if (row === 'mode') stepMode(delta);
    if (row === 'level') stepLevel(delta);
  };
  const toggleReady = () => me && client.setReady(!me.ready);
  const askLeave = () => {
    if (leaving) return onLeave();
    setLeaving(true);
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setLeaving(false), 2500);
  };

  useScreenKeys(
    (action) => {
      if (action === 'back') return askLeave();
      setLeaving(false);
      if (action === 'up') setRow(ROWS[wrap(ROWS.indexOf(row) - 1, ROWS.length)]!);
      else if (action === 'down') setRow(ROWS[wrap(ROWS.indexOf(row) + 1, ROWS.length)]!);
      else if (action === 'left') change(-1);
      else if (action === 'right') change(1);
      else if (action === 'confirm') toggleReady();
    },
    (event) => {
      if (event.key === 'i' || event.key === 'I') void copyInvite();
      if (event.key === 'c' || event.key === 'C') {
        setRow('character');
        stepCharacter(event.shiftKey ? -1 : 1);
      }
    },
  );

  const status = leaving ? (
    <span className={r.warn}>Press {pocket ? 'B' : 'Esc'} again to leave the room.</span>
  ) : room.campaignComplete && finalScores[0] ? (
    <span>
      <b className={r.win}>{race ? `${finalScores[0].name} wins the race!` : 'Campaign complete!'}</b>{' '}
      {race
        ? finalScores.map((p) => `${p.name} ${p.campaignScore}`).join(' · ')
        : `Team total ${finalScores.reduce((sum, p) => sum + p.campaignScore, 0)} pts.`}{' '}
      Ready up to play again.
    </span>
  ) : tooFew ? (
    `${mode.name} needs at least ${mode.minPlayers} players. Share the code, or switch to Race to play alone.`
  ) : (
    <>
      {mode.name} from “{selected?.name ?? room.selectedLevelId}” starts when everyone is ready.
      {waitingOn.length > 0 && ` Waiting on ${waitingOn.join(', ')}.`}
      {!pocket && scaling && ` ${scaling}`}
    </>
  );

  const slots = Array.from({ length: MAX_PLAYERS }, (_, slot) => {
    const player = bySlot.get(slot);
    const style = PLAYER_SLOTS[slot]!;
    const vars = { '--slot': style.css } as CSSProperties;
    if (!player) {
      return (
        <div key={slot} className={pocket ? r.slotEmptyPocket : r.slotEmpty} style={{ ...vars, ...slotPosition(pocket, slot) }}>
          {style.label} · {pocket ? 'open' : 'waiting for a friend…'}
        </div>
      );
    }
    const you = player.id === view.selfId;
    const focused = you && row === 'character';
    return (
      <Btn
        key={slot}
        className={pocket ? r.slotPocket : r.slot}
        style={{ ...vars, ...slotPosition(pocket, slot) }}
        data-focus={focused}
        disabled={!you}
        onMouseEnter={() => you && setRow('character')}
        onClick={() => you && stepCharacter(1)}
      >
        <span className={r.slotPortrait}>
          <CharacterPortrait characterId={player.characterId} scale={pocket ? 1.375 : 2} animated={focused} clip={focused ? 'run' : 'idle'} />
        </span>
        <span className={r.slotBody}>
          <span className={r.slotTop}>
            <span className={r.tag}>{style.label}</span>
            {player.isHost && !pocket && <span className={r.host}>Host</span>}
          </span>
          <span className={r.slotName}>
            {player.name}
            {you && !pocket && <span className={r.you}> (you)</span>}
          </span>
          {!pocket && (
            <span className={r.slotMeta}>
              {CHARACTERS[player.characterId].name} · {abilityName(player.characterId)}
              {room.campaignComplete && ` · ${player.campaignScore} pts`}
            </span>
          )}
        </span>
        {!player.connected ? (
          <span className={r.state} data-state="away">
            {pocket ? '…' : 'Reconnecting'}
          </span>
        ) : (
          <span className={r.state} data-state={player.ready ? 'ready' : 'idle'}>
            {pocket ? (player.ready ? '✓' : '…') : player.ready ? '✓ Ready' : 'Not ready'}
          </span>
        )}
        {focused && (
          <>
            <span className={r.slotPrev} aria-hidden />
            <span className={r.slotNext} aria-hidden />
          </>
        )}
      </Btn>
    );
  });

  const hostNote = isHost ? '' : pocket ? '' : ' · host picks';
  const modeCards = GAME_MODES.map((m) => {
    if (pocket && m !== room.mode) return null;
    return (
      <Btn
        key={m}
        className={r.modeCard}
        data-on={m === room.mode}
        disabled={!isHost}
        onClick={() => isHost && client.selectMode(m)}
        onMouseEnter={() => setRow('mode')}
      >
        <img src={MODE_ART[m]} alt="" draggable={false} />
        <span className={r.modeName}>{MODE_CONFIG[m].name}</span>
        {m === room.mode && !pocket && <span className={r.on}>On</span>}
      </Btn>
    );
  });
  const levelThumb = selected && (
    <span className={r.levelThumb} style={{ backgroundImage: `url(${levelTile(selected)})` }}>
      <span className={r.levelNo}>{levelIndex + 1}</span>
      {selected.next === null && <span className={r.levelTag}>{race ? 'Finale' : 'Boss'}</span>}
    </span>
  );

  if (pocket) {
    return (
      <ScreenStage
        label={`Room ${room.roomId}`}
        crumb="Room"
        status={line}
        hints={[
          { controls: ['moveV'], label: 'Move' },
          { controls: ['moveH'], label: 'Change' },
          { controls: ['confirm'], label: me?.ready ? 'Unready' : 'Ready' },
          { controls: ['back'], label: 'Leave' },
        ]}
      >
        <Btn className={r.codePocket} onClick={() => void copyInvite()}>
          <span className={r.code}>{room.roomId}</span>
          <span className={r.codeNote}>
            {connected.length} / {MAX_PLAYERS} · {copied ? 'link copied!' : 'tap code to share'}
          </span>
        </Btn>
        {slots}
        <div className={`${s.panel} ${r.setupPocket}`}>
          <div className={r.cell} data-focus={row === 'mode'} onMouseEnter={() => setRow('mode')}>
            <div className={r.cellLabel}>Mode{isHost ? ' ◂ ▸' : ''}</div>
            {modeCards}
          </div>
          <div className={r.cell} data-focus={row === 'level'} onMouseEnter={() => setRow('level')}>
            <div className={r.cellLabel}>Level{isHost ? ' ◂ ▸' : ''}</div>
            <Btn className={r.levelBox} disabled={!isHost} onClick={() => stepLevel(1)}>
              {levelThumb}
            </Btn>
          </div>
          <div className={r.setupLine}>{leaving || room.campaignComplete || tooFew ? status : `${selected?.name ?? ''} · ${connected.filter((p) => p.ready).length}/${connected.length} ready`}</div>
        </div>
        <Btn className={r.readyPocket} data-ready={me?.ready ?? false} data-focus={row === 'ready'} disabled={!me} onClick={toggleReady} onMouseEnter={() => setRow('ready')}>
          <PadA className={r.readyGlyph} />
          {me?.ready ? 'Not ready' : 'Ready'}
        </Btn>
      </ScreenStage>
    );
  }

  return (
    <ScreenStage
      label={`Room ${room.roomId}`}
      crumb={<Crumb>Room {room.roomId}</Crumb>}
      status={line}
      hints={[
        { controls: ['moveV'], label: 'Move' },
        { controls: ['moveH'], label: 'Change' },
        { controls: ['confirm'], label: me?.ready ? 'Not ready' : 'Ready' },
        { controls: [{ key: 'I' }], label: copied ? 'Copied!' : 'Copy invite' },
      ]}
      hintsRight={[{ controls: ['back'], label: 'Leave room' }]}
    >
      <div className={r.codeRow}>
        <span className={s.label}>Room</span>
        <span className={r.code}>{room.roomId}</span>
        <Btn className={r.invite} onClick={() => void copyInvite()}>
          {inviteUrl.replace(/^https?:\/\//, '')} · <Key>I</Key>
          {copied ? 'copied!' : 'copy invite'}
        </Btn>
      </div>
      <div className={r.players}>
        <div className={s.label}>
          Players · {connected.length} / {MAX_PLAYERS}
        </div>
        {slots}
      </div>
      <div className={`${s.panel} ${r.modePanel}`} data-focus={row === 'mode'} onMouseEnter={() => setRow('mode')}>
        <div className={s.label}>Mode{hostNote}</div>
        <div className={r.modeCards}>{modeCards}</div>
      </div>
      <div className={`${s.panel} ${r.levelPanel}`} data-focus={row === 'level'} onMouseEnter={() => setRow('level')}>
        <div className={s.label}>
          Starting level · {levelIndex + 1} / {levels.length}
          {hostNote}
        </div>
        <div className={r.levelPicker}>
          <Btn className={r.arrowPrev} aria-label="Previous level" disabled={!isHost} onClick={() => stepLevel(-1)} />
          {levelThumb}
          <Btn className={r.arrowNext} aria-label="Next level" disabled={!isHost} onClick={() => stepLevel(1)} />
        </div>
        <div className={r.levelName}>{selected?.name ?? room.selectedLevelId}</div>
      </div>
      <div className={r.readyRow}>
        <p className={r.readyText} aria-live="polite">
          {status}
        </p>
        <Btn className={r.ready} data-ready={me?.ready ?? false} data-focus={row === 'ready'} disabled={!me} onClick={toggleReady} onMouseEnter={() => setRow('ready')}>
          {me?.ready ? 'Unready' : 'Ready'}
          <Key className={r.readyKey}>⏎</Key>
        </Btn>
      </div>
    </ScreenStage>
  );
}

function slotPosition(pocket: boolean, slot: number): CSSProperties {
  if (pocket) return { left: 12 + (slot % 2) * 142, top: 70 + Math.floor(slot / 2) * 74 };
  return { top: 24 + slot * 90 };
}
