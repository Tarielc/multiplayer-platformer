'use client';

import {
  BACKGROUND_TILES,
  CHARACTER_IDS,
  CHARACTERS,
  GAME_MODES,
  LEVELS,
  MAX_PLAYERS,
  MODE_CONFIG,
  PLAYER_CONFIG,
  type CharacterId,
  type GameMode,
  type LevelManifestEntry,
} from '@platformer/shared';
import { useRef, useState, type ReactNode } from 'react';
import { ABILITY_BLURBS, BACKDROP_URL, abilityName } from '@/components/brand';
import { CharacterPortrait } from '@/components/CharacterPortrait';
import { loadAudioSettings, saveAudioSettings } from '@/game/audio/audioSettings';
import { DEFAULT_ASSET_BASE } from '@/game/services';
import { useRoomActions, useServerHealth, type ServerState } from '@/hooks/useHomeActions';
import { loadPlayerName, loadPreferredCharacter, savePlayerName, savePreferredCharacter } from '@/net/identity';
import { AbilityTile, Btn, Crumb, Logo, Menu, ServerStatusLine, type MenuItem } from './parts';
import { useScreenKeys, type ScreenKind } from './screenEnv';
import { Key, PadA, ScreenStage, useStageKind, type Hint } from './ScreenStage';
import s from './screens.module.css';

type View = 'title' | 'characters' | 'join' | 'how' | 'settings';

const MENU: readonly MenuItem[] = [
  { id: 'solo', label: 'Play solo', sub: 'Race the clock' },
  { id: 'create', label: 'Create room', sub: `Invite up to ${MAX_PLAYERS - 1} friends` },
  { id: 'join', label: 'Join room', sub: 'Got a code?' },
  { id: 'characters', label: 'Characters', sub: `${CHARACTER_IDS.length} sprouts, ${CHARACTER_IDS.length} specials` },
  { id: 'how', label: 'How to play', sub: 'Modes, levels, controls' },
  { id: 'settings', label: 'Settings', sub: 'Sound, your name' },
];

export const MODE_ART: Record<GameMode, string> = { coop: '/ui/mode-coop.png', race: '/ui/mode-race.png' };

export function levelTile(entry: LevelManifestEntry): string {
  return `${DEFAULT_ASSET_BASE}/backgrounds/${entry.background ?? BACKGROUND_TILES[0]}.png`;
}

const wrap = (i: number, n: number) => (i + n) % n;

/**
 * The home page on the CRT or the handheld: a title screen with a menu, and the screens it opens.
 * The plain site's long page (HomeScreen) is for an ordinary browser window.
 */
export function ScreenHome() {
  const kind = useStageKind();
  const server = useServerHealth();
  const [view, setView] = useState<View>('title');
  const [menu, setMenu] = useState(0);
  const [name, setName] = useState(loadPlayerName);
  const [character, setCharacter] = useState<CharacterId | null>(loadPreferredCharacter);
  const actions = useRoomActions(() => savePlayerName(name));
  const status = <ServerStatusLine server={server} kind={kind} />;
  const back = () => {
    actions.setError(null);
    setView('title');
  };
  const pick = (index: number) => {
    const id = MENU[index]?.id;
    if (actions.busy || !id) return;
    if (id === 'solo' || id === 'create') void actions.createRoom(id === 'solo');
    else setView(id as View);
  };
  const shared = { kind, status, back };

  if (view === 'characters') {
    return (
      <CharactersView
        {...shared}
        initial={character ?? CHARACTER_IDS[0]!}
        name={name}
        setName={setName}
        onPick={(id) => {
          setCharacter(id);
          savePreferredCharacter(id);
          back();
        }}
      />
    );
  }
  if (view === 'join') return <JoinView {...shared} error={actions.error} onJoin={actions.joinRoom} />;
  if (view === 'how') return <HowView {...shared} />;
  if (view === 'settings') return <SettingsView {...shared} name={name} setName={setName} />;
  return (
    <TitleView
      {...shared}
      menu={menu}
      setMenu={setMenu}
      onPick={pick}
      onCharacters={() => setView('characters')}
      name={name.trim() || PLAYER_CONFIG.defaultName}
      character={character ?? CHARACTER_IDS[0]!}
      note={actions.busy ? 'Opening a room…' : actions.error}
      server={server}
    />
  );
}

interface ViewProps {
  kind: ScreenKind;
  status: ReactNode;
  back: () => void;
}

/* ---------------------------------------------------------------- title */

function TitleView({
  kind,
  status,
  menu,
  setMenu,
  onPick,
  onCharacters,
  name,
  character,
  note,
  server,
}: ViewProps & {
  menu: number;
  setMenu: (i: number) => void;
  onPick: (i: number) => void;
  onCharacters: () => void;
  name: string;
  character: CharacterId;
  note: string | null;
  server: ServerState;
}) {
  useScreenKeys(
    (action) => {
      if (action === 'up') setMenu(wrap(menu - 1, MENU.length));
      else if (action === 'down') setMenu(wrap(menu + 1, MENU.length));
      else if (action === 'confirm') onPick(menu);
    },
    (event) => {
      if (event.key === 'c' || event.key === 'C') onCharacters();
    },
  );
  const pocket = kind === 'pocket';
  const offline = server.kind === 'offline' ? 'The game server is not reachable. Start everything with npm run dev.' : null;
  const coop = LEVELS.campaign('coop').length;
  const race = LEVELS.campaign('race').length;
  return (
    <ScreenStage
      label="Title"
      tone="title"
      crumb={<Crumb />}
      status={status}
      hints={[
        { controls: ['moveV'], label: 'Choose' },
        { controls: ['confirm'], label: 'Select' },
        { controls: [{ key: 'C' }], label: 'Character' },
      ]}
      hintsRight={pocket ? ['Select: full screen'] : [`1–${MAX_PLAYERS} players`]}
    >
      <img className={pocket ? s.titleBackdropPocket : s.titleBackdrop} src={BACKDROP_URL} alt="" draggable={false} />
      <div className={pocket ? s.titleScrimPocket : s.titleScrim} aria-hidden />
      <div className={pocket ? s.heroPocket : s.hero}>
        <CharacterPortrait characterId={character} scale={pocket ? 2 : 6} animated clip="run" />
      </div>
      {pocket ? (
        <Logo className={s.logoPocket} />
      ) : (
        <>
          <Logo className={s.logoCrt} />
          <p className={s.blurb}>
            Team up through {coop} co-op levels to topple the rhino, or race your friends to the trophy across {race} more.
            1–{MAX_PLAYERS} players.
          </p>
        </>
      )}
      <Menu
        items={pocket ? MENU.map(({ sub: _sub, ...item }) => item) : MENU}
        index={menu}
        onIndex={setMenu}
        onPick={onPick}
        className={pocket ? s.menuPocket : s.menuCrt}
      />
      {!pocket && (
        <Btn className={`${s.panel} ${s.youCard}`} onClick={onCharacters}>
          <span className={s.youPortrait}>
            <CharacterPortrait characterId={character} scale={2} />
          </span>
          <span className={s.label}>You · press C</span>
          <span className={s.youName}>{name}</span>
          <span className={s.youAbility}>
            <AbilityTile characterId={character} size={22} />
            {CHARACTERS[character].name} · {abilityName(character)}
          </span>
        </Btn>
      )}
      {(note ?? offline) && (
        <p className={pocket ? s.titleNotePocket : s.titleNote} role="alert">
          {note ?? offline}
        </p>
      )}
    </ScreenStage>
  );
}

/* ----------------------------------------------------------- characters */

function CharactersView({
  kind,
  status,
  back,
  initial,
  name,
  setName,
  onPick,
}: ViewProps & { initial: CharacterId; name: string; setName: (name: string) => void; onPick: (id: CharacterId) => void }) {
  const [index, setIndex] = useState(Math.max(0, CHARACTER_IDS.indexOf(initial)));
  const field = useRef<HTMLInputElement>(null);
  const id = CHARACTER_IDS[index]!;
  const commitName = () => setName(savePlayerName(name));
  const step = (delta: number) => setIndex(wrap(index + delta, CHARACTER_IDS.length));
  useScreenKeys((action) => {
    const typing = document.activeElement === field.current && field.current !== null;
    if (typing) {
      if (action === 'confirm' || action === 'up' || action === 'back') {
        field.current?.blur();
        commitName();
      }
      return;
    }
    if (action === 'left') step(-1);
    else if (action === 'right') step(1);
    else if (action === 'down') field.current?.focus();
    else if (action === 'confirm') {
      commitName();
      onPick(id);
    } else if (action === 'back') {
      commitName();
      back();
    }
  });
  const choose = (i: number) => {
    if (i === index) {
      commitName();
      onPick(CHARACTER_IDS[i]!);
    } else setIndex(i);
  };
  const pocket = kind === 'pocket';
  return (
    <ScreenStage
      label="Characters"
      crumb={<Crumb>Characters</Crumb>}
      status={status}
      hints={[
        { controls: ['moveH'], label: 'Choose' },
        { controls: ['confirm'], label: 'Pick' },
        { controls: [{ key: '↓' }], label: 'Name' },
        { controls: ['back'], label: 'Back' },
      ]}
      hintsRight={[`${index + 1} / ${CHARACTER_IDS.length}`]}
    >
      <h2 className={pocket ? s.headingPocket : s.heading}>Pick your sprout</h2>
      {pocket ? (
        <>
          <Btn className={s.carouselPrev} aria-label="Previous character" onClick={() => step(-1)} />
          <Btn className={s.carouselNext} aria-label="Next character" onClick={() => step(1)} />
          <Btn className={s.carouselStage} onClick={() => choose(index)}>
            <CharacterPortrait key={id} characterId={id} scale={3.5} animated clip="run" />
          </Btn>
          <div className={s.carouselName}>{CHARACTERS[id].name}</div>
          <div className={s.dots} aria-hidden>
            {CHARACTER_IDS.map((other, i) => (
              <span key={other} data-on={i === index} />
            ))}
          </div>
        </>
      ) : (
        CHARACTER_IDS.map((other, i) => (
          <Btn
            key={other}
            className={s.pedestal}
            data-on={i === index}
            style={{ left: 78 + i * 206 }}
            onMouseEnter={() => setIndex(i)}
            onClick={() => choose(i)}
          >
            {i === index && <span className={s.pedestalArrow} aria-hidden />}
            <span className={s.alcove}>
              <CharacterPortrait characterId={other} scale={5} animated={i === index} clip={i === index ? 'run' : 'idle'} />
            </span>
            <span className={s.plinth} aria-hidden />
            <span className={s.pedestalName}>{CHARACTERS[other].name}</span>
            <span className={s.pedestalAbility}>
              <AbilityTile characterId={other} size={20} />
              {abilityName(other)}
            </span>
          </Btn>
        ))
      )}
      <div className={`${s.panel} ${pocket ? s.infoPocket : s.info}`} aria-live="polite">
        <AbilityTile characterId={id} size={pocket ? 40 : 96} className={pocket ? undefined : s.bigBadge} />
        <div>
          <div className={s.labelGold}>{pocket ? 'Special · S stick' : 'Special ability · S / right-click'}</div>
          <div className={s.abilityName}>{abilityName(id)}</div>
          <p className={s.abilityBlurb}>{ABILITY_BLURBS[id]}</p>
        </div>
        {!pocket && (
          <label className={s.nameBox}>
            <span className={s.label}>Your name</span>
            <input
              ref={field}
              className={s.field}
              value={name}
              maxLength={PLAYER_CONFIG.nameMaxLength}
              placeholder={PLAYER_CONFIG.defaultName}
              autoComplete="nickname"
              spellCheck={false}
              onChange={(event) => setName(event.target.value)}
              onBlur={commitName}
            />
            <span className={s.fieldNote}>Shown over your head and in the room.</span>
          </label>
        )}
      </div>
    </ScreenStage>
  );
}

/* ----------------------------------------------------------------- join */

function JoinView({ kind, status, back, error, onJoin }: ViewProps & { error: string | null; onJoin: (code: string) => boolean }) {
  const [code, setCode] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useScreenKeys((action) => {
    if (action === 'back') back();
    else if (action === 'confirm') {
      if (document.activeElement !== field.current) field.current?.focus();
      else if (code.trim()) onJoin(code);
    }
  });
  const pocket = kind === 'pocket';
  return (
    <ScreenStage
      label="Join a room"
      crumb={<Crumb>Join room</Crumb>}
      status={status}
      hints={[
        { controls: ['confirm'], label: 'Join' },
        { controls: ['back'], label: 'Back' },
      ]}
    >
      <h2 className={pocket ? s.headingPocket : s.heading}>Join a room</h2>
      <div className={`${s.panel} ${pocket ? s.joinPocket : s.join}`}>
        <label className={s.joinLabel} htmlFor="screen-room-code">
          Room code
        </label>
        <input
          id="screen-room-code"
          ref={field}
          className={`${s.field} ${s.codeField}`}
          value={code}
          autoFocus={!pocket}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="ABCDE"
          maxLength={12}
          spellCheck={false}
          autoCapitalize="characters"
          autoComplete="off"
        />
        <p className={s.fieldNote}>
          {pocket ? 'Tap the box to type the code the host shares.' : 'Type the code the host shares, then press Enter.'}
        </p>
        <Btn className={s.go} disabled={code.trim() === ''} onClick={() => onJoin(code)}>
          {pocket ? <PadA className={s.goGlyph} /> : <Key className={s.goKey}>⏎</Key>}
          Join
        </Btn>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </ScreenStage>
  );
}

/* ---------------------------------------------------------- how to play */

const TABS = ['Modes', 'Levels', 'Controls'] as const;
type Tab = (typeof TABS)[number];
const ALL_LEVELS = GAME_MODES.flatMap((mode) => LEVELS.campaign(mode));

function HowView({ kind, status, back }: ViewProps) {
  const [tab, setTab] = useState<Tab>('Modes');
  const [mode, setMode] = useState(0);
  const [level, setLevel] = useState(0);
  const turn = (delta: number) => setTab(TABS[wrap(TABS.indexOf(tab) + delta, TABS.length)]!);
  useScreenKeys(
    (action) => {
      if (action === 'back') back();
      else if (action === 'left') turn(-1);
      else if (action === 'right') turn(1);
      else if (action === 'up' || action === 'down') {
        const delta = action === 'up' ? -1 : 1;
        if (tab === 'Modes') setMode(wrap(mode + delta, GAME_MODES.length));
        if (tab === 'Levels') setLevel(wrap(level + delta, ALL_LEVELS.length));
      }
    },
    (event) => {
      if (event.key === 'q' || event.key === 'Q') turn(-1);
      if (event.key === 'e' || event.key === 'E') turn(1);
    },
  );
  const pocket = kind === 'pocket';
  return (
    <ScreenStage
      label="How to play"
      crumb={<Crumb>How to play</Crumb>}
      status={status}
      hints={[
        { controls: ['moveH'], label: 'Tabs' },
        ...(tab === 'Controls' ? [] : [{ controls: ['moveV'], label: 'Browse' } satisfies Hint]),
        { controls: ['back'], label: 'Back' },
      ]}
    >
      <div className={pocket ? s.tabsPocket : s.tabs} role="tablist">
        {TABS.map((t) => (
          <Btn key={t} role="tab" aria-selected={t === tab} className={s.tab} data-on={t === tab} onClick={() => setTab(t)}>
            {t}
          </Btn>
        ))}
      </div>
      {tab === 'Modes' && <ModesTab pocket={pocket} index={mode} setIndex={setMode} />}
      {tab === 'Levels' && <LevelsTab pocket={pocket} index={level} setIndex={setLevel} />}
      {tab === 'Controls' && <ControlsTab pocket={pocket} />}
    </ScreenStage>
  );
}

function ModesTab({ pocket, index, setIndex }: { pocket: boolean; index: number; setIndex: (i: number) => void }) {
  return (
    <div className={pocket ? s.modesPocket : s.modes}>
      {GAME_MODES.map((mode, i) => {
        const config = MODE_CONFIG[mode];
        return (
          <Btn key={mode} className={s.modeCard} data-on={i === index} data-mode={mode} onMouseEnter={() => setIndex(i)}>
            <span className={s.modeArt}>
              <img src={MODE_ART[mode]} alt="" draggable={false} />
              <span className={s.modeName}>{config.name}</span>
            </span>
            <span className={s.modeMeta}>
              {config.race ? `${config.race.placePoints.join(' · ')} pts by place` : 'Shared checkpoints'} ·{' '}
              {config.minPlayers > 1 ? `${config.minPlayers}–${MAX_PLAYERS} players` : `1–${MAX_PLAYERS} players`}
            </span>
            {(!pocket || i === index) && <span className={s.modeSummary}>{config.summary}</span>}
          </Btn>
        );
      })}
    </div>
  );
}

function LevelsTab({ pocket, index, setIndex }: { pocket: boolean; index: number; setIndex: (i: number) => void }) {
  const selected = ALL_LEVELS[index]!;
  const campaign = LEVELS.campaign(selected.mode);
  const position = campaign.findIndex((e) => e.id === selected.id);
  const final = selected.next === null;
  let offset = 0;
  return (
    <>
      {GAME_MODES.map((mode, row) => {
        const levels = LEVELS.campaign(mode);
        const start = offset;
        offset += levels.length;
        const width = Math.min(206, Math.floor((872 - (levels.length - 1) * 16) / levels.length));
        return (
          <section key={mode} className={pocket ? s.levelRowPocket : s.levelRow} style={{ top: pocket ? 60 + row * 70 : 132 + row * 212 }}>
            <div className={mode === 'coop' ? s.labelMoss : s.labelGold}>
              {mode === 'coop'
                ? pocket
                  ? 'Co-op · topple the rhino'
                  : 'Co-op · 2-player button puzzles, then the rhino'
                : pocket
                  ? 'Race · first to the trophy'
                  : 'Race · several routes to the trophy, every one passable alone'}
            </div>
            <div className={s.levelCards}>
              {levels.map((entry, i) => (
                <Btn
                  key={entry.id}
                  className={s.levelCard}
                  data-on={start + i === index}
                  style={pocket ? undefined : { width }}
                  onMouseEnter={() => setIndex(start + i)}
                  onClick={() => setIndex(start + i)}
                >
                  <span className={s.levelThumb} style={{ backgroundImage: `url(${levelTile(entry)})` }}>
                    <span className={s.levelNo}>{i + 1}</span>
                    {entry.next === null && <span className={s.levelTag}>{mode === 'coop' ? 'Boss' : 'Finale'}</span>}
                  </span>
                  {!pocket && <span className={s.levelName}>{entry.name}</span>}
                </Btn>
              ))}
            </div>
          </section>
        );
      })}
      <div className={`${s.panel} ${pocket ? s.levelInfoPocket : s.levelInfo}`} aria-live="polite">
        <div className={s.label}>
          {MODE_CONFIG[selected.mode].name} · {position + 1} / {campaign.length}
          {final && (selected.mode === 'coop' ? ' · Boss' : ' · Finale')}
        </div>
        <div className={s.levelInfoName}>{selected.name}</div>
        <p className={s.levelInfoText}>
          {position === 0
            ? `Where the ${MODE_CONFIG[selected.mode].name.toLowerCase()} campaign starts.`
            : final
              ? selected.mode === 'coop'
                ? 'The last stand: beat the rhino together.'
                : 'The last leg: first to the trophy takes the race.'
              : `Follows ${campaign[position - 1]?.name ?? 'the level before'}.`}{' '}
          The host can start from any level in the lobby.
        </p>
      </div>
    </>
  );
}

interface ControlRow {
  action: string;
  keys: string[];
  pad: string;
  pocket: string;
}

const CONTROL_ROWS: ControlRow[] = [
  { action: 'Move', keys: ['←', '→', 'A', 'D'], pad: 'Left stick, D-pad', pocket: 'D-pad' },
  { action: 'Jump · hold for higher, again to double', keys: ['Space', '↑', 'W'], pad: 'A / B', pocket: 'A' },
  { action: 'Drop through planks', keys: ['↓', '+ jump'], pad: 'Down + A', pocket: 'Down + A' },
  { action: 'Attack', keys: ['J', 'X'], pad: 'X / □', pocket: 'B' },
  { action: 'Special · aim, then let go', keys: ['L', 'C', 'right-click'], pad: 'Y / RB, right stick aims', pocket: 'S stick: drag, let go' },
  { action: 'Menu', keys: ['Esc'], pad: 'Start', pocket: 'Start' },
];

function ControlsTab({ pocket }: { pocket: boolean }) {
  if (pocket) {
    return (
      <ul className={`${s.panel} ${s.controlsPocket}`}>
        {[...CONTROL_ROWS, { action: 'Full screen', keys: [], pad: '', pocket: 'Select' }].map((row) => (
          <li key={row.action}>
            <span className={s.controlAction}>{row.action.split(' · ')[0]}</span>
            <span className={s.controlPocket}>{row.pocket}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className={`${s.panel} ${s.controls}`}>
      <div className={s.controlsHead}>
        <span>Action</span>
        <span>Keyboard</span>
        <span>Gamepad</span>
        <span>Handheld</span>
      </div>
      {CONTROL_ROWS.map((row) => (
        <div key={row.action} className={s.controlsRow}>
          <span className={s.controlAction}>{row.action}</span>
          <span className={s.controlKeys}>
            {row.keys.map((key) =>
              key.startsWith('+') || key === 'right-click' ? (
                <span key={key}>{key}</span>
              ) : (
                <Key key={key}>{key}</Key>
              ),
            )}
          </span>
          <span>{row.pad}</span>
          <span>{row.pocket}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- settings */

const SETTING_ROWS = ['sound', 'volume', 'name'] as const;

function SettingsView({ kind, status, back, name, setName }: ViewProps & { name: string; setName: (name: string) => void }) {
  const [row, setRow] = useState(0);
  const [audio, setAudio] = useState(loadAudioSettings);
  const field = useRef<HTMLInputElement>(null);
  const update = (next: typeof audio) => setAudio(saveAudioSettings(next));
  const commitName = () => setName(savePlayerName(name));
  const change = (delta: number) => {
    const id = SETTING_ROWS[row];
    if (id === 'sound') update({ ...audio, muted: !audio.muted });
    if (id === 'volume') update({ ...audio, volume: Math.round((audio.volume + delta * 0.1) * 10) / 10 });
  };
  useScreenKeys((action) => {
    if (document.activeElement === field.current && field.current) {
      if (action === 'confirm' || action === 'back' || action === 'up' || action === 'down') {
        field.current.blur();
        commitName();
        if (action === 'up') setRow(wrap(row - 1, SETTING_ROWS.length));
        if (action === 'down') setRow(wrap(row + 1, SETTING_ROWS.length));
      }
      return;
    }
    if (action === 'back') back();
    else if (action === 'up') setRow(wrap(row - 1, SETTING_ROWS.length));
    else if (action === 'down') setRow(wrap(row + 1, SETTING_ROWS.length));
    else if (action === 'left') change(-1);
    else if (action === 'right') change(1);
    else if (action === 'confirm') {
      if (SETTING_ROWS[row] === 'name') field.current?.focus();
      else change(1);
    }
  });
  const pocket = kind === 'pocket';
  const volume = Math.round(audio.volume * 100);
  return (
    <ScreenStage
      label="Settings"
      crumb={<Crumb>Settings</Crumb>}
      status={status}
      hints={[
        { controls: ['moveV'], label: 'Choose' },
        { controls: ['moveH'], label: 'Change' },
        { controls: ['back'], label: 'Back' },
      ]}
    >
      <h2 className={pocket ? s.headingPocket : s.heading}>Settings</h2>
      <div className={`${s.panel} ${pocket ? s.settingsPocket : s.settings}`}>
        <Btn className={s.setting} data-on={row === 0} onMouseEnter={() => setRow(0)} onClick={() => update({ ...audio, muted: !audio.muted })}>
          <span className={s.cur} aria-hidden />
          <span className={s.settingName}>Sound</span>
          <span className={s.toggle} data-on={!audio.muted}>
            <span>On</span>
            <span>Off</span>
          </span>
        </Btn>
        <div className={s.setting} data-on={row === 1} onMouseEnter={() => setRow(1)}>
          <span className={s.cur} aria-hidden />
          <span className={s.settingName}>Volume</span>
          <span className={s.volume}>
            <Btn className={s.stepper} aria-label="Quieter" onClick={() => update({ ...audio, volume: Math.max(0, audio.volume - 0.1) })}>
              ◀
            </Btn>
            <span className={s.meter} aria-label={`${volume}%`}>
              {Array.from({ length: 10 }, (_, i) => (
                <span key={i} data-on={i < Math.round(audio.volume * 10)} />
              ))}
            </span>
            <Btn className={s.stepper} aria-label="Louder" onClick={() => update({ ...audio, volume: Math.min(1, audio.volume + 0.1) })}>
              ▶
            </Btn>
          </span>
        </div>
        <label className={s.setting} data-on={row === 2} onMouseEnter={() => setRow(2)}>
          <span className={s.cur} aria-hidden />
          <span className={s.settingName}>Name</span>
          <input
            ref={field}
            className={`${s.field} ${s.settingField}`}
            value={name}
            maxLength={PLAYER_CONFIG.nameMaxLength}
            placeholder={PLAYER_CONFIG.defaultName}
            autoComplete="nickname"
            spellCheck={false}
            onFocus={() => setRow(2)}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
          />
        </label>
      </div>
      <p className={pocket ? s.settingsNotePocket : s.settingsNote}>
        {pocket ? 'Select on the handheld switches full screen.' : 'Saved in this browser. Sound settings also apply in a game.'}
      </p>
    </ScreenStage>
  );
}
