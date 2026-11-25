import { type CharacterId, type HintImage, type LevelHint, isHintImage } from '@platformer/shared';
import * as Phaser from 'phaser';
import { abilityAnim } from '../abilities/abilityAnimations';
import { ABILITY_SHEETS, type AbilityAnimDef, TONGUE_COLORS, abilityIconKey, animLengthMs, frameAt, frameName } from '../abilities/abilityArt';
import { CHARACTER_SHEET, CLIPS, type ClipName, clipDurationMs, sheetFrame } from '../characters/characterArt';
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
  key: 0xf7f1e3,
  keyPressed: 0xffd35a,
  keySide: 0x9c8f7a,
  keyOutline: 0x3b2a1a,
  puff: 0xffffff,
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

/** Key signs: board size (posts below it), the picture's ground line, keycap height. */
const KEY_SIGN = { width: 80, height: 64, ground: -14, keyHeight: 16 } as const;
/** Centres of a key sign's two halves: keycaps on the left, the small player on the right. */
const KEYS_X = -16;
const DEMO_X = 18;

/** A keycap on a key sign (an arrow, a key name, or a mouse button: `mouse-left` / `mouse-right`), lit while `pressed(ms)`. */
interface KeyCap {
  x: number;
  y: number;
  label: string;
  pressed: (ms: number) => boolean;
}

type KeyImage = Extract<HintImage, `key-${string}`>;

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
  /** Who the control signs show: the local player's character once it is known. */
  private demo: CharacterId = 'virtual-guy';
  /** Keycaps mean nothing on a touch-first device (it has on-screen sticks instead). */
  private readonly touchFirst = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

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

  /** The control signs act with this character (the local player's). */
  setDemoCharacter(id: CharacterId): void {
    this.demo = id;
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
      case 'key-move':
      case 'key-jump':
      case 'key-double-jump':
      case 'key-attack':
      case 'key-ability':
        if (!this.touchFirst) this.keySign(image, x, y);
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

  /**
   * A small sign teaching one control: its keycap(s) on the left light up while a small player
   * (the local player's character) on the right does what the key does. No words but key names.
   */
  private keySign(image: KeyImage, x: number, y: number): void {
    const { scene } = this;
    const { width, height, ground } = KEY_SIGN;
    const sign = scene.add.container(x, y).setDepth(VIEW_CONFIG.depth.entities - 2);
    this.objects.push(sign);
    const g = scene.add.graphics();
    g.fillStyle(SIGN.post).fillRect(-20, -10, 4, 10).fillRect(16, -10, 4, 10);
    g.fillStyle(SIGN.woodDark).fillRoundedRect(-width / 2, -height, width, height - 8, 4);
    g.fillStyle(SIGN.wood).fillRoundedRect(-width / 2 + 2, -height + 2, width - 4, height - 12, 3);
    g.fillStyle(SIGN.parchment).fillRect(-width / 2 + 5, -height + 6, width - 10, height - 20);
    g.fillStyle(SIGN.grass).fillRect(DEMO_X - 15, ground, 30, 2);
    sign.add(g);

    const lesson = this.lesson(image);
    // The keycaps: redrawn each frame (a pressed one sinks a pixel and lights up), names on top.
    const caps = scene.add.graphics();
    sign.add(caps);
    const names = lesson.keys.map((key) => {
      if (key.label === 'left' || key.label === 'right' || key.label.startsWith('mouse-')) return null;
      const text = scene.add
        .text(key.x, key.y, key.label, { fontFamily: VIEW_CONFIG.label.fontFamily, fontSize: '9px', fontStyle: 'bold', color: SIGN.ink })
        .setOrigin(0.5, 0.5)
        .setResolution(3);
      sign.add(text);
      return text;
    });
    const icon = image === 'key-ability' && scene.textures.exists(abilityIconKey(this.demo)) ? scene.add.image(DEMO_X, ground - 18, abilityIconKey(this.demo)) : null;
    if (icon) sign.add(icon);
    const fx = scene.add.graphics();
    sign.add(fx);
    const player = this.character(sign, this.demo, DEMO_X, ground);
    if (!player) return;
    player.setVisible(image !== 'key-ability');

    this.loop(lesson.total, (ms) => {
      this.drawKeys(caps, names, lesson.keys, ms);
      fx.clear();
      if (icon) {
        // The player's own ability icon, popping when the key goes down.
        const key = abilityIconKey(this.demo);
        if (icon.texture.key !== key && scene.textures.exists(key)) icon.setTexture(key);
        const t = (ms - lesson.at) / 400;
        const pop = t >= 0 && t < 1 ? Math.sin(t * Math.PI) : 0;
        icon.setScale(1 + 0.3 * pop);
        if (pop > 0) fx.lineStyle(1, SIGN.keyPressed, pop).strokeCircle(DEMO_X, ground - 18, 18 + 8 * t);
        return;
      }
      lesson.act(player, fx, ms);
    });
  }

  /** What a key sign shows: its keycaps, and how the small player moves over one loop. */
  private lesson(image: KeyImage): {
    keys: KeyCap[];
    total: number;
    /** When the main key goes down. */
    at: number;
    act: (player: Phaser.GameObjects.Sprite, fx: Phaser.GameObjects.Graphics, ms: number) => void;
  } {
    const ground = KEY_SIGN.ground;
    const row = -KEY_SIGN.height / 2 - 8;
    const held = (from: number, to: number) => (ms: number) => ms >= from && ms < to;
    switch (image) {
      case 'key-move': {
        // Runs right, stops, runs back left, stops.
        const [x0, x1] = [DEMO_X - 6, DEMO_X + 6];
        return {
          keys: [
            { x: KEYS_X - 10, y: row, label: 'left', pressed: held(1300, 2300) },
            { x: KEYS_X + 10, y: row, label: 'right', pressed: held(0, 1000) },
          ],
          total: 2600,
          at: 0,
          act: (player, _fx, ms) => {
            if (ms < 1000) player.setPosition(x0 + (x1 - x0) * (ms / 1000), ground).setFlipX(false).setFrame(this.frame('run', ms));
            else if (ms < 1300) player.setPosition(x1, ground).setFrame(this.frame('idle', ms));
            else if (ms < 2300) player.setPosition(x1 - (x1 - x0) * ((ms - 1300) / 1000), ground).setFlipX(true).setFrame(this.frame('run', ms));
            else player.setPosition(x0, ground).setFrame(this.frame('idle', ms));
          },
        };
      }
      case 'key-jump': {
        const [up, air] = [600, 640];
        return {
          keys: [{ x: KEYS_X, y: row, label: 'SPACE', pressed: held(up - 40, up + 220) }],
          total: 1800,
          at: up,
          act: (player, _fx, ms) => {
            const t = (ms - up) / air;
            player.setFlipX(false);
            if (t < 0 || t >= 1) player.setPosition(DEMO_X, ground).setFrame(this.frame('idle', ms));
            else player.setPosition(DEMO_X, ground - 14 * 4 * t * (1 - t)).setFrame(this.airFrame(t < 0.5, ms - up));
          },
        };
      }
      case 'key-double-jump': {
        // A jump, and near its top a second one from the air (a puff where it pushes off).
        // Second part: height 9 + a·t − b·t², topping out at 18 and landing at t = 1.
        const [up, first, second, peak] = [500, 240, 620, 9];
        const again = up + first;
        const a = 43.46;
        const b = a + peak;
        return {
          keys: [
            { x: KEYS_X, y: row - 10, label: 'SPACE', pressed: held(up - 40, up + 160) },
            { x: KEYS_X, y: row + 10, label: 'SPACE', pressed: held(again - 20, again + 160) },
          ],
          total: 2200,
          at: up,
          act: (player, fx, ms) => {
            player.setFlipX(false);
            if (ms < up || ms >= again + second) {
              player.setPosition(DEMO_X, ground).setFrame(this.frame('idle', ms));
            } else if (ms < again) {
              const t = (ms - up) / first;
              player.setPosition(DEMO_X, ground - peak * (1 - (1 - t) ** 2)).setFrame(this.airFrame(true, ms - up));
            } else {
              const t = (ms - again) / second;
              player.setPosition(DEMO_X, ground - Math.max(0, peak + a * t - b * t * t)).setFrame(this.airFrame(t < 0.414, ms - again));
              if (ms - again < 240) {
                const k = (ms - again) / 240;
                fx.lineStyle(1, SIGN.puff, 1 - k).strokeEllipse(DEMO_X, ground - peak, 10 + 12 * k, 3 + 3 * k);
              }
            }
          },
        };
      }
      case 'key-attack': {
        const swing = 600;
        const length = clipDurationMs('attack');
        const frames = CLIPS.attack.frames;
        return {
          keys: [{ x: KEYS_X, y: row, label: 'mouse-left', pressed: held(swing - 40, swing + 160) }],
          total: 1800,
          at: swing,
          act: (player, _fx, ms) => {
            player.setPosition(DEMO_X - 6, ground).setFlipX(false);
            if (ms >= swing && ms < swing + length) player.setFrame(sheetFrame(this.demo, 'attack', Math.min(frames - 1, Math.floor(((ms - swing) / length) * frames))));
            else player.setFrame(this.frame('idle', ms));
          },
        };
      }
      case 'key-ability': {
        const use = 600;
        return { keys: [{ x: KEYS_X, y: row, label: 'mouse-right', pressed: held(use - 40, use + 220) }], total: 1800, at: use, act: () => {} };
      }
    }
  }

  private drawKeys(caps: Phaser.GameObjects.Graphics, names: readonly (Phaser.GameObjects.Text | null)[], keys: readonly KeyCap[], ms: number): void {
    const h = KEY_SIGN.keyHeight;
    caps.clear();
    keys.forEach((key, i) => {
      const down = key.pressed(ms);
      if (key.label === 'mouse-left' || key.label === 'mouse-right') {
        this.drawMouse(caps, key.x, key.y, key.label === 'mouse-left' ? -1 : 1, down);
        return;
      }
      const arrow = key.label === 'left' || key.label === 'right';
      const w = arrow ? h : Math.max(h, key.label.length * 6 + 8);
      const top = key.y - h / 2 + (down ? 1 : 0);
      caps.fillStyle(SIGN.keyOutline).fillRoundedRect(key.x - w / 2 - 1, key.y - h / 2 - 1, w + 2, h + 3, 3);
      caps.fillStyle(SIGN.keySide).fillRoundedRect(key.x - w / 2, top, w, h + (down ? 0 : 1), 2);
      caps.fillStyle(down ? SIGN.keyPressed : SIGN.key).fillRoundedRect(key.x - w / 2, top, w, h - 2, 2);
      const cy = top + (h - 2) / 2;
      caps.fillStyle(SIGN.keyOutline);
      if (key.label === 'left') caps.fillTriangle(key.x - 4, cy, key.x + 3, cy - 5, key.x + 3, cy + 5);
      else if (key.label === 'right') caps.fillTriangle(key.x + 4, cy, key.x - 3, cy - 5, key.x - 3, cy + 5);
      names[i]?.setY(cy);
    });
  }

  /** A mouse centred on (x, y): its left (`side` -1) or right (1) button lit and sunk while `down`. */
  private drawMouse(g: Phaser.GameObjects.Graphics, x: number, y: number, side: -1 | 1, down: boolean): void {
    const [w, h, buttons] = [16, 22, 9];
    const [left, top] = [x - w / 2, y - h / 2];
    g.fillStyle(SIGN.keyOutline).fillRoundedRect(left - 1, top - 1, w + 2, h + 2, 7);
    g.fillStyle(SIGN.key).fillRoundedRect(left, top, w, h, 6);
    // The button: its half of the top, sunk a pixel and lit.
    const bx = side < 0 ? left : x;
    g.fillStyle(down ? SIGN.keyPressed : SIGN.key).fillRoundedRect(bx, top + (down ? 1 : 0), w / 2, buttons, side < 0 ? { tl: 6, tr: 0, bl: 0, br: 0 } : { tl: 0, tr: 6, bl: 0, br: 0 });
    // Seams: between the buttons, and under them.
    g.fillStyle(SIGN.keyOutline).fillRect(x - 0.5, top, 1, buttons).fillRect(left, top + buttons, w, 1);
    g.fillStyle(SIGN.keySide).fillRect(left + 2, top + h - 3, w - 4, 1);
  }

  /** Frame of a looping clip of the demo character. */
  private frame(clip: ClipName, ms: number): number {
    const def = CLIPS[clip];
    return sheetFrame(this.demo, clip, Math.floor((ms / 1000) * (def.frameRate ?? 10)) % def.frames);
  }

  /** Rising (jump) or falling frame of the demo character, `ms` into the air. */
  private airFrame(rising: boolean, ms: number): number {
    return rising ? sheetFrame(this.demo, 'jump', Math.min(CLIPS.jump.frames - 1, Math.floor(ms / 70))) : sheetFrame(this.demo, 'fall', 1);
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
