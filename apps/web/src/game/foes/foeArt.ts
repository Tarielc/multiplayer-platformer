import { FOE_TUNING, type FoeKind, type NetFoeState, type NetShotState, type ShotKind } from '@platformer/shared';
import type { AbilitySheetDef, AbilitySheetFile } from '../abilities/abilityArt';

/**
 * Foe art as data (no Phaser import). The sheets (`packages/shared/data/sprites/foes/`) use the
 * ability sheet format, so they load and register the same way; frames are picked from the
 * replicated state clock (`NetFoeState.t`), never from Phaser animations.
 */
const dir = 'sprites/foes';

export const FOE_SHEETS: Readonly<Record<FoeKind | ShotKind, AbilitySheetFile>> = {
  mushroom: { key: 'foe:mushroom', path: `${dir}/mushroom` },
  chicken: { key: 'foe:chicken', path: `${dir}/chicken` },
  wasp: { key: 'foe:wasp', path: `${dir}/wasp` },
  monkey: { key: 'foe:monkey', path: `${dir}/monkey` },
  bull: { key: 'foe:bull', path: `${dir}/bull` },
  rhino: { key: 'foe:rhino', path: `${dir}/rhino` },
  stinger: { key: 'foe:stinger', path: `${dir}/wasp_stinger` },
  banana: { key: 'foe:banana', path: `${dir}/monkey_banana` },
  shockwave: { key: 'foe:shockwave', path: `${dir}/rhino_shockwave` },
  rock: { key: 'foe:rock', path: `${dir}/rhino_rock` },
};

export function allFoeSheets(): AbilitySheetFile[] {
  return Object.values(FOE_SHEETS);
}

/** A clip of a foe sheet; `scale` > 1 plays it slower than drawn (a chicken's stroll is its run at half speed). */
export interface FoeClip {
  anim: string;
  scale: number;
}

const clip = (anim: string, scale = 1): FoeClip => ({ anim, scale });

/** The rhino is in a rage at half health or less (it plays its enrage clip on the way). */
export function rhinoRage(foe: Pick<NetFoeState, 'hp'>): boolean {
  return foe.hp <= FOE_TUNING.rhino.hp / 2;
}

/** Which clip shows a foe's state. */
export function foeClip(foe: Pick<NetFoeState, 'kind' | 'state' | 'wall' | 'hp'>): FoeClip {
  const { state } = foe;
  if (state === 'dead') return clip('death');
  // On a tongue, in a claw, in a mouth (not drawn) or spat out: wriggling.
  if (state === 'held' || state === 'swallowed' || state === 'flying') return clip('hurt');
  switch (foe.kind) {
    case 'mushroom':
      return clip(state === 'walk' ? 'walk' : state === 'hurt' ? 'hurt' : 'idle');
    case 'chicken':
      if (state === 'walk') return clip('run', 2);
      if (state === 'chase') return clip('run');
      return clip(state === 'alert' || state === 'attack' || state === 'hurt' ? state : 'idle');
    case 'wasp':
      return clip(state === 'shoot' || state === 'hurt' ? state : 'fly');
    case 'monkey': {
      const wall = foe.wall !== 0;
      if (state === 'walk') return clip(wall ? 'wall_climb' : 'run');
      if (state === 'throw') return clip(wall ? 'wall_throw' : 'throw');
      if (state === 'attack') return clip(wall ? 'wall_swipe' : 'melee');
      if (state === 'hurt') return clip(wall ? 'wall_hurt' : 'hurt');
      return clip(wall ? 'wall_idle' : 'idle');
    }
    case 'bull':
      return clip(state === 'windup' || state === 'charge' || state === 'crash' || state === 'stunned' || state === 'walk' || state === 'hurt' ? state : 'idle');
    case 'rhino': {
      const rage = rhinoRage(foe);
      switch (state) {
        case 'idle':
        case 'walk':
        case 'charge':
          return clip(rage ? `${state}_rage` : state);
        case 'attack':
          return clip('horn_swipe');
        case 'roar':
        case 'windup':
        case 'crash':
        case 'stunned':
        case 'stomp':
        case 'block':
        case 'enrage':
        case 'hurt':
          return clip(state);
        default:
          return clip(rage ? 'idle_rage' : 'idle');
      }
    }
  }
}

export function shotClip(shot: Pick<NetShotState, 'kind' | 'hit' | 't'>): string {
  switch (shot.kind) {
    case 'stinger':
      return shot.hit ? 'impact' : 'fly';
    case 'banana':
      return shot.hit ? 'splat' : 'spin';
    case 'shockwave':
      return shot.hit ? 'fade' : 'travel';
    case 'rock':
      return shot.hit ? 'shatter' : shot.t < FOE_TUNING.rock.warnMs / 1000 ? 'warn' : 'fall';
  }
}

/**
 * Where a shot's sprite pivot goes (shots are positioned by their centre). A shockwave's pivot
 * is on the ground; a hanging rock's `warn` frames hang from the frame top, so that goes on the
 * ceiling; a shattered rock's pieces lie a little below the frame's middle.
 */
export function shotPivot(shot: Pick<NetShotState, 'kind' | 'x' | 'y' | 'hit' | 't'>, sheet: AbilitySheetDef | null): { x: number; y: number } {
  if (shot.kind === 'shockwave') return { x: shot.x, y: shot.y + FOE_TUNING.shockwave.height / 2 };
  if (shot.kind === 'rock') {
    const half = FOE_TUNING.rock.height / 2;
    const pivotY = sheet?.pivot?.y ?? 12;
    if (shotClip(shot) === 'warn') return { x: shot.x, y: shot.y - half + pivotY };
    if (shot.hit) return { x: shot.x, y: shot.y + half - 6 };
  }
  return { x: shot.x, y: shot.y };
}

/**
 * Where a foe's sprite pivot goes. Most sheets put the pivot at the feet. A wasp's pivot is the
 * middle of its body; a monkey on a wall is drawn `wallX` px from the wall it holds.
 */
export function foePivot(foe: Pick<NetFoeState, 'kind' | 'x' | 'y' | 'wall'>, sheet: AbilitySheetDef | null): { x: number; y: number } {
  if (foe.kind === 'wasp') return { x: foe.x, y: foe.y - FOE_TUNING.wasp.height / 2 };
  if (foe.kind === 'monkey' && foe.wall !== 0) {
    const wallX = (sheet as { wallX?: number } | null)?.wallX ?? 8;
    const pivotX = sheet?.pivot?.x ?? 20;
    // The hitbox's edge is on the wall; the drawn wall line is `pivotX - wallX` px behind the pivot.
    const offset = pivotX - wallX - FOE_TUNING.monkey.width / 2;
    return { x: foe.x - foe.wall * offset, y: foe.y };
  }
  return { x: foe.x, y: foe.y };
}
