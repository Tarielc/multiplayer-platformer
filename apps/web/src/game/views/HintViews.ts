import { type CharacterId, type HintImage, type LevelHint, isHintImage } from '@platformer/shared';
import * as Phaser from 'phaser';
import { abilityAnim } from '../abilities/abilityAnimations';
import { ABILITY_SHEETS, type AbilityAnimDef, TONGUE_COLORS, animLengthMs, frameAt, frameName } from '../abilities/abilityArt';
import { CHARACTER_SHEET, type ClipName, sheetFrame } from '../characters/characterArt';
import { VIEW_CONFIG } from '../config';

/** Colours of the hint signs (wood board, parchment, ink). */
const SIGN = {
  wood: 0xb07a45,
  woodDark: 0x4a2c17,
  post: 0x6b4226,
  parchment: 0xf2dfb5,
  ink: '#3b2a1a',
  grass: 0x6aa84f,
  grassDark: 0x3f7a35,
  ledge: 0xe8b93a,
  ledgeDark: 0x9a6f12,
  button: 0xd94c3a,
  path: 0x8a6a45,
  cable: 0x8b93af,
} as const;

/** Width a text hint wraps at, px. */
const NOTE_WRAP = 200;
const NOTE_PAD = 5;

/** Height of a picture sign from the floor to the top of its board, px. */
const PICTURE_HEIGHT = 164;
/** The picture's ground line, relative to the sign's foot. */
const GROUND = -26;
/** The ledge with the button every picture gets a teammate up to. */
const LEDGE = { x0: 16, x1: 48, y: -100, button: 34 } as const;
/** Where the teammate ends up: on the ledge, left of the button. */
const ON_LEDGE = { x: 26, y: LEDGE.y } as const;

/** A teammate's flight onto the ledge, as a quadratic curve (sprite feet positions). */
interface Arc {
  from: { x: number; y: number };
  control: { x: number; y: number };
  to: { x: number; y: number };
}

/**
 * Hint signs from the level's `hint` objects: pure decoration, drawn behind everything that
 * moves. A text hint is a parchment note; a picture hint (`image`) is a wooden sign standing on
 * the floor that acts out what to do. Both sit with their bottom-centre on the object.
 */
export class HintViews {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    hints: readonly LevelHint[],
  ) {
    for (const hint of hints) {
      if (hint.image !== null && isHintImage(hint.image)) {
        this.picture(hint.image, hint.x, hint.y);
        // Text with a picture goes above the sign.
        if (hint.text) this.note(hint.text, hint.x, hint.y - PICTURE_HEIGHT - 4);
      } else if (hint.text) {
        this.note(hint.text, hint.x, hint.y);
      }
    }
  }

  destroy(): void {
    for (const object of this.objects) object.destroy();
    this.objects.length = 0;
  }

  /** A parchment note with its bottom-centre at (x, y). */
  private note(text: string, x: number, y: number): void {
    const { depth, label } = VIEW_CONFIG;
    const words = this.scene.add
      .text(x, y - NOTE_PAD, text, {
        fontFamily: label.fontFamily,
        fontSize: `${label.fontSize}px`,
        color: SIGN.ink,
        align: 'center',
        lineSpacing: 2,
        wordWrap: { width: NOTE_WRAP, useAdvancedWrap: true },
      })
      .setOrigin(0.5, 1)
      .setResolution(2)
      .setDepth(depth.entities - 2);
    const w = Math.ceil(words.width) + NOTE_PAD * 2;
    const h = Math.ceil(words.height) + NOTE_PAD * 2;
    const board = this.scene.add.graphics().setDepth(depth.entities - 2.1);
    board.fillStyle(SIGN.woodDark, 0.9).fillRoundedRect(x - w / 2 - 2, y - h - 2, w + 4, h + 4, 4);
    board.fillStyle(SIGN.parchment, 0.95).fillRoundedRect(x - w / 2, y - h, w, h, 3);
    this.objects.push(board, words);
  }

  private picture(image: HintImage, x: number, y: number): void {
    switch (image) {
      case 'giant-boost':
        this.giantBoost(x, y);
        break;
      case 'frog-spit':
        this.frogSpit(x, y);
        break;
      case 'drone-lift':
        this.droneLift(x, y);
        break;
    }
  }

  /** The wooden sign: posts, board, parchment, the picture's ground and the button ledge. */
  private board(x: number, y: number): Phaser.GameObjects.Container {
    const sign = this.scene.add.container(x, y).setDepth(VIEW_CONFIG.depth.entities - 2);
    this.objects.push(sign);
    const g = this.scene.add.graphics();
    g.fillStyle(SIGN.post).fillRect(-34, -16, 5, 16).fillRect(29, -16, 5, 16);
    g.fillStyle(SIGN.woodDark).fillRoundedRect(-58, -PICTURE_HEIGHT, 116, PICTURE_HEIGHT - 12, 5);
    g.fillStyle(SIGN.wood).fillRoundedRect(-56, -PICTURE_HEIGHT + 2, 112, PICTURE_HEIGHT - 16, 4);
    g.fillStyle(SIGN.parchment).fillRect(-51, -PICTURE_HEIGHT + 7, 102, PICTURE_HEIGHT - 26);
    g.fillStyle(SIGN.grass).fillRect(-51, GROUND - 2, 102, 5);
    g.fillStyle(SIGN.grassDark).fillRect(-51, GROUND + 3, 102, 2);
    g.fillStyle(SIGN.ledgeDark).fillRect(LEDGE.x0, LEDGE.y, LEDGE.x1 - LEDGE.x0, 5);
    g.fillStyle(SIGN.ledge).fillRect(LEDGE.x0, LEDGE.y, LEDGE.x1 - LEDGE.x0, 3);
    g.fillStyle(SIGN.button).fillRect(LEDGE.button - 4, LEDGE.y - 3, 8, 3);
    sign.add(g);
    return sign;
  }

  /** The way the teammate goes, dotted (drawn a little above their feet, through their middle). */
  private dots(sign: Phaser.GameObjects.Container, arc: Arc): void {
    const g = this.scene.add.graphics();
    g.fillStyle(SIGN.path);
    for (let i = 1; i < 10; i++) {
      const p = arcPoint(arc, i / 10);
      g.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
    }
    sign.add(g);
  }

  /** A character from the shared sheet, feet at (x, y); null while the sheet isn't loaded. */
  private character(sign: Phaser.GameObjects.Container, id: CharacterId, x: number, y: number): Phaser.GameObjects.Sprite | null {
    if (!this.scene.textures.exists(CHARACTER_SHEET.key)) return null;
    const sprite = this.scene.add.sprite(x, y, CHARACTER_SHEET.key, sheetFrame(id, 'idle', 0)).setOrigin(0.5, 1);
    sign.add(sprite);
    return sprite;
  }

  /** One endless loop of `total` ms, `draw` called with the time into it. */
  private loop(total: number, draw: (ms: number) => void): void {
    this.scene.tweens.addCounter({
      from: 0,
      to: total,
      duration: total,
      repeat: -1,
      onUpdate: (tween) => draw(tween.getValue() ?? 0),
    });
  }

  /**
   * Giant Mask Dude standing on the sign's grass, a teammate on his head who jumps off it, high
   * along a dotted arc, onto the ledge with the button; then again.
   */
  private giantBoost(x: number, y: number): void {
    const sign = this.board(x, y);
    const giantX = -24;
    // From the giant's head (his art is about 40 px tall) over the top of the panel.
    const arc: Arc = { from: { x: giantX + 2, y: GROUND - 40 }, control: { x: 0, y: -150 }, to: ON_LEDGE };
    this.dots(sign, arc);

    const giantKey = ABILITY_SHEETS.bigForm.key;
    const idle = abilityAnim(giantKey, 'big_idle');
    const giant = idle && this.scene.textures.exists(giantKey) ? this.scene.add.sprite(giantX, GROUND, giantKey, frameName('big_idle', 0)).setOrigin(0.5, 1) : null;
    if (giant) sign.add(giant);
    const buddy = this.character(sign, 'bunny-man', arc.from.x, arc.from.y);
    if (!buddy) return;

    // Wait on the head, jump the arc, stand on the ledge, fade.
    const wait = 700;
    const flight = 800;
    const stand = 1000;
    const fade = 250;
    this.loop(wait + flight + stand + fade, (ms) => {
      if (giant && idle) giant.setFrame(frameName('big_idle', frameAt(idle, ms)));
      buddy.setAlpha(1);
      if (ms < wait) {
        pose(buddy, 'bunny-man', 'idle', ms).setPosition(arc.from.x, arc.from.y);
      } else if (ms < wait + flight) {
        fly(buddy, 'bunny-man', arc, (ms - wait) / flight);
      } else {
        const on = ms - wait - flight;
        pose(buddy, 'bunny-man', 'idle', on).setPosition(ON_LEDGE.x, ON_LEDGE.y);
        if (on > stand) buddy.setAlpha(1 - (on - stand) / fade);
      }
    });
  }

  /**
   * Ninja Frog shoots his tongue at a teammate, reels them in and swallows them, then spits
   * them high along a dotted arc onto the ledge with the button; then again.
   */
  private frogSpit(x: number, y: number): void {
    const sign = this.board(x, y);
    const frogX = -34;
    const buddyX = 25;
    const arc: Arc = { from: { x: frogX + 12, y: GROUND - 6 }, control: { x: 6, y: -160 }, to: ON_LEDGE };
    this.dots(sign, arc);

    const key = ABILITY_SHEETS.tongueCaster.key;
    const clips = { tongue: abilityAnim(key, 'tongue'), gulp: abilityAnim(key, 'gulp'), hold: abilityAnim(key, 'hold'), spit: abilityAnim(key, 'spit') };
    const frog = this.character(sign, 'ninja-frog', frogX, GROUND);
    const buddy = this.character(sign, 'bunny-man', buddyX, GROUND);
    if (!frog || !buddy) return;
    const { tongue, gulp, hold, spit } = clips;
    const canAct = tongue && gulp && hold && spit && this.scene.textures.exists(key);
    // The caster sheet's frames are 96x32 with the frog's feet at (32, 31).
    const casterOrigin = [32 / 96, 31 / 32] as const;
    // How far ahead of the frog's feet the tongue's tip is, per frame of `tongue`.
    const tip = [0, 0, 25, 41, 59, 59, 40, 23];

    const wait = 600;
    const lick = tongue ? animLengthMs(tongue) : 800;
    const swallow = gulp ? animLengthMs(gulp) : 210;
    const chew = 500;
    const spitLength = spit ? animLengthMs(spit) : 400;
    const launch = wait + lick + swallow + chew + 100; // the spit's second frame
    const flight = 750;
    const stand = 900;
    const fade = 250;
    const act = (clip: AbilityAnimDef | null, name: string, ms: number) => {
      if (!clip) return 0;
      const i = frameAt(clip, ms);
      frog.setTexture(key, frameName(name, i)).setOrigin(...casterOrigin);
      return i;
    };
    this.loop(launch + flight + stand + fade, (ms) => {
      buddy.setAlpha(1).setVisible(true);
      // The frog.
      if (!canAct || ms < wait || ms >= launch - 100 + spitLength) {
        frog.setTexture(CHARACTER_SHEET.key, sheetFrame('ninja-frog', 'idle', Math.floor(ms / 50) % 11)).setOrigin(0.5, 1);
      } else if (ms < wait + lick) {
        const i = act(tongue, 'tongue', ms - wait);
        // Caught on the tongue's way back: they ride its tip into his mouth.
        if (i >= 6) buddy.setX(frogX + (tip[i] ?? 0));
      } else if (ms < wait + lick + swallow) {
        act(gulp, 'gulp', ms - wait - lick);
      } else if (ms < launch - 100) {
        act(hold, 'hold', ms - wait - lick - swallow);
      } else {
        act(spit, 'spit', ms - launch + 100);
      }
      // The teammate.
      if (ms < wait + lick) {
        pose(buddy, 'bunny-man', ms < wait + 500 ? 'idle' : 'hurt', ms).setY(GROUND);
        if (ms < wait + 500 || !canAct) buddy.setX(buddyX);
      } else if (ms < launch) {
        buddy.setVisible(!canAct);
        if (!canAct) pose(buddy, 'bunny-man', 'idle', ms).setPosition(buddyX, GROUND);
      } else if (ms < launch + flight) {
        fly(buddy, 'bunny-man', arc, (ms - launch) / flight);
      } else {
        const on = ms - launch - flight;
        pose(buddy, 'bunny-man', 'idle', on).setPosition(ON_LEDGE.x, ON_LEDGE.y);
        if (on > stand) buddy.setAlpha(1 - (on - stand) / fade);
      }
    });
  }

  /**
   * Virtual Guy pilots his Claw Drone: it lowers the claw onto a teammate, grabs them, flies
   * them up onto the ledge with the button and lets go; then flies back for another.
   */
  private droneLift(x: number, y: number): void {
    const sign = this.board(x, y);
    const pilotX = -36;
    const buddyX = -4;
    // The teammate's feet, from the grass up to the ledge (a gentle curve, the drone climbing first).
    const arc: Arc = { from: { x: buddyX, y: GROUND }, control: { x: buddyX, y: ON_LEDGE.y - 10 }, to: ON_LEDGE };
    this.dots(sign, arc);

    const pilotKey = ABILITY_SHEETS.pilot.key;
    const droneKey = ABILITY_SHEETS.drone.key;
    const clawKey = ABILITY_SHEETS.claw.key;
    const pilotClip = abilityAnim(pilotKey, 'pilot');
    const excited = abilityAnim(pilotKey, 'pilot_excited');
    const hover = abilityAnim(droneKey, 'hover');
    const carry = abilityAnim(droneKey, 'carry_fly');
    const close = abilityAnim(clawKey, 'close');
    const art = pilotClip && excited && hover && carry && close && [pilotKey, droneKey, clawKey].every((k) => this.scene.textures.exists(k));
    const buddy = this.character(sign, 'mask-dude', buddyX, GROUND);
    if (!buddy) return;
    if (!art) return;

    // The pilot sits on the grass (feet at (32, 39) of a 64x40 frame).
    const pilot = this.scene.add.sprite(pilotX, GROUND, pilotKey, frameName('pilot', 0)).setOrigin(32 / 64, 39 / 40);
    const cable = this.scene.add.graphics();
    const claw = this.scene.add.sprite(0, 0, clawKey, frameName('open', 0)).setOrigin(0.5, 0);
    const drone = this.scene.add.sprite(0, 0, droneKey, frameName('hover', 0));
    sign.add([pilot, cable, claw, drone]);

    // Sizes: the drone's winch is 9 px below its centre; the claw grips 5 px below its top, on the
    // teammate's head (24 px above their feet); a carried teammate hangs on a 4 px cable.
    const winch = 9;
    const headToClawTop = 24 + 3;
    const hoverY = -128;
    const carriedDrop = winch + 4 + headToClawTop; // drone centre to the teammate's feet

    const wait = 400;
    const lower = 500;
    const grab = 160;
    const lift = 1100;
    const release = 300;
    const back = 900;
    const fade = 250;
    const total = wait + lower + grab + lift + release + back;
    const draw = (droneX: number, droneY: number, clawTop: number, clawFrame: string, carrying: boolean, ms: number) => {
      const clip = carrying ? carry : hover;
      drone.setPosition(droneX, droneY).setFrame(frameName(carrying ? 'carry_fly' : 'hover', frameAt(clip!, ms)));
      claw.setPosition(droneX, clawTop).setFrame(clawFrame);
      const top = droneY + winch;
      cable.clear();
      if (clawTop > top + 1) {
        cable.fillStyle(TONGUE_COLORS.outline, 1).fillRect(Math.round(droneX) - 1, top, 2, clawTop - top);
        cable.fillStyle(SIGN.cable, 1).fillRect(Math.round(droneX) - 1, top, 1, clawTop - top);
      }
    };
    this.loop(total, (ms) => {
      const busy = ms >= wait && ms < wait + lower + grab + lift;
      pilot.setFrame(frameName(busy ? 'pilot_excited' : 'pilot', frameAt(busy ? excited! : pilotClip!, ms)));
      buddy.setAlpha(1);
      const restingClaw = hoverY + winch + 4;
      const onHead = GROUND - headToClawTop;
      if (ms < wait) {
        draw(buddyX, hoverY, restingClaw, frameName('open', 0), false, ms);
        pose(buddy, 'mask-dude', 'idle', ms).setPosition(buddyX, GROUND);
      } else if (ms < wait + lower) {
        const t = easeOut((ms - wait) / lower);
        draw(buddyX, hoverY, restingClaw + (onHead - restingClaw) * t, frameName('open', 0), false, ms);
        pose(buddy, 'mask-dude', 'idle', ms).setPosition(buddyX, GROUND);
      } else if (ms < wait + lower + grab) {
        const into = ms - wait - lower;
        draw(buddyX, hoverY, onHead, frameName('close', frameAt(close!, into)), false, ms);
        pose(buddy, 'mask-dude', 'idle', ms).setPosition(buddyX, GROUND);
      } else if (ms < wait + lower + grab + lift) {
        // The teammate follows the dotted path; the drone flies above them, reeling them in.
        const t = easeInOut((ms - wait - lower - grab) / lift);
        const feet = arcPoint(arc, t);
        const cableLeft = (GROUND - hoverY - winch - headToClawTop - 4) * (1 - t);
        const droneY = feet.y - carriedDrop - cableLeft;
        draw(feet.x, droneY, feet.y - headToClawTop, frameName('close', 2), true, ms);
        buddy.setPosition(feet.x, feet.y).setFrame(sheetFrame('mask-dude', 'fall', 1));
      } else if (ms < wait + lower + grab + lift + release) {
        // Let go on the ledge, then reel the claw up.
        const into = ms - wait - lower - grab - lift;
        const droneY = ON_LEDGE.y - carriedDrop;
        const t = easeOut(into / release);
        const clawTop = ON_LEDGE.y - headToClawTop - 6 * t;
        draw(ON_LEDGE.x, droneY, clawTop, frameName('release', Math.min(1, Math.floor(into / 60))), false, ms);
        pose(buddy, 'mask-dude', 'idle', into).setPosition(ON_LEDGE.x, ON_LEDGE.y);
      } else {
        // Fly back over the teammate's spot while they fade from the ledge (the next one appears).
        const into = ms - wait - lower - grab - lift - release;
        const t = easeInOut(into / back);
        const fromY = ON_LEDGE.y - carriedDrop;
        draw(ON_LEDGE.x + (buddyX - ON_LEDGE.x) * t, fromY + (hoverY - fromY) * t, fromY + (hoverY - fromY) * t + winch + 4, frameName('open', 0), false, ms);
        pose(buddy, 'mask-dude', 'idle', into).setPosition(ON_LEDGE.x, ON_LEDGE.y);
        buddy.setAlpha(Math.max(0, 1 - into / fade));
      }
    });
  }
}

/** Sets an idle-style looping pose of a sheet character (20 fps). */
function pose(sprite: Phaser.GameObjects.Sprite, id: CharacterId, clip: ClipName, ms: number): Phaser.GameObjects.Sprite {
  const frames = clip === 'idle' ? 11 : clip === 'hurt' ? 4 : 1;
  return sprite.setFrame(sheetFrame(id, clip, Math.floor(ms / 50) % frames));
}

/** Places a flying character at `t` (0..1) along `arc`: jumping on the way up, falling down. */
function fly(sprite: Phaser.GameObjects.Sprite, id: CharacterId, arc: Arc, t: number): void {
  const p = arcPoint(arc, t);
  sprite.setPosition(p.x, p.y).setFrame(t < 0.5 ? sheetFrame(id, 'jump', Math.min(3, Math.floor(t * 8))) : sheetFrame(id, 'fall', 1));
}

function arcPoint(arc: Arc, t: number): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * arc.from.x + 2 * u * t * arc.control.x + t * t * arc.to.x,
    y: u * u * arc.from.y + 2 * u * t * arc.control.y + t * t * arc.to.y,
  };
}

const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 2;
const easeInOut = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 2 * c * c : 1 - (-2 * c + 2) ** 2 / 2;
};
