import { type HintImage, type LevelHint, isHintImage } from '@platformer/shared';
import * as Phaser from 'phaser';
import { abilityAnim } from '../abilities/abilityAnimations';
import { ABILITY_SHEETS, frameAt, frameName } from '../abilities/abilityArt';
import { CHARACTER_SHEET, sheetFrame } from '../characters/characterArt';
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
} as const;

/** Width a text hint wraps at, px. */
const NOTE_WRAP = 200;
const NOTE_PAD = 5;

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
    }
  }

  /**
   * Giant Mask Dude standing on the sign's grass, a teammate on his head who jumps off it, high
   * along a dotted arc, onto a ledge with a button; then again.
   */
  private giantBoost(x: number, y: number): void {
    const { scene } = this;
    const sign = scene.add.container(x, y).setDepth(VIEW_CONFIG.depth.entities - 2);
    this.objects.push(sign);

    const g = scene.add.graphics();
    // Posts, board, parchment panel.
    g.fillStyle(SIGN.post).fillRect(-34, -16, 5, 16).fillRect(29, -16, 5, 16);
    g.fillStyle(SIGN.woodDark).fillRoundedRect(-58, -PICTURE_HEIGHT, 116, PICTURE_HEIGHT - 12, 5);
    g.fillStyle(SIGN.wood).fillRoundedRect(-56, -PICTURE_HEIGHT + 2, 112, PICTURE_HEIGHT - 16, 4);
    g.fillStyle(SIGN.parchment).fillRect(-51, -PICTURE_HEIGHT + 7, 102, PICTURE_HEIGHT - 26);
    // The picture's ground, and the ledge with its button.
    g.fillStyle(SIGN.grass).fillRect(-51, GROUND - 2, 102, 5);
    g.fillStyle(SIGN.grassDark).fillRect(-51, GROUND + 3, 102, 2);
    g.fillStyle(SIGN.ledgeDark).fillRect(LEDGE.x0, LEDGE.y, LEDGE.x1 - LEDGE.x0, 5);
    g.fillStyle(SIGN.ledge).fillRect(LEDGE.x0, LEDGE.y, LEDGE.x1 - LEDGE.x0, 3);
    g.fillStyle(SIGN.button).fillRect(LEDGE.button - 4, LEDGE.y - 3, 8, 3);
    // The jump's path, dotted.
    g.fillStyle(SIGN.path);
    for (let i = 1; i < 10; i++) {
      const p = arcPoint(i / 10);
      g.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
    }
    sign.add(g);

    const giantKey = ABILITY_SHEETS.bigForm.key;
    const idle = abilityAnim(giantKey, 'big_idle');
    const giant = idle && scene.textures.exists(giantKey) ? scene.add.sprite(GIANT_X, GROUND, giantKey, frameName('big_idle', 0)).setOrigin(0.5, 1) : null;
    const charactersLoaded = scene.textures.exists(CHARACTER_SHEET.key);
    const buddy = charactersLoaded ? scene.add.sprite(ARC.from.x, ARC.from.y, CHARACTER_SHEET.key, sheetFrame(BUDDY, 'idle', 0)).setOrigin(0.5, 1) : null;
    if (giant) sign.add(giant);
    if (buddy) sign.add(buddy);
    if (!buddy) return;

    // One loop: wait on the head, jump the arc (rising, then falling), stand on the ledge, fade.
    const wait = 700;
    const flight = 800;
    const stand = 1000;
    const fade = 250;
    const total = wait + flight + stand + fade;
    scene.tweens.addCounter({
      from: 0,
      to: total,
      duration: total,
      repeat: -1,
      onUpdate: (tween) => {
        const ms = tween.getValue() ?? 0;
        if (giant && idle) giant.setFrame(frameName('big_idle', frameAt(idle, ms)));
        buddy.setAlpha(1);
        if (ms < wait) {
          buddy.setPosition(ARC.from.x, ARC.from.y).setFrame(sheetFrame(BUDDY, 'idle', Math.floor(ms / 50) % 11));
        } else if (ms < wait + flight) {
          const t = (ms - wait) / flight;
          const p = arcPoint(t);
          buddy.setPosition(p.x, p.y).setFrame(t < 0.5 ? sheetFrame(BUDDY, 'jump', Math.min(3, Math.floor(t * 8))) : sheetFrame(BUDDY, 'fall', 1));
        } else {
          const on = ms - wait - flight;
          buddy.setPosition(ARC.to.x, ARC.to.y).setFrame(sheetFrame(BUDDY, 'idle', Math.floor(on / 50) % 11));
          if (on > stand) buddy.setAlpha(1 - (on - stand) / fade);
        }
      },
    });
  }
}

/** Height of a picture sign from the floor to the top of its board, px. */
const PICTURE_HEIGHT = 146;
/** The picture's ground line, relative to the sign's foot. */
const GROUND = -26;
const GIANT_X = -24;
/** The teammate who gets launched (anyone but Mask Dude). */
const BUDDY = 'bunny-man' as const;
const LEDGE = { x0: 16, x1: 48, y: -100, button: 34 } as const;
/** From the giant's head (his art is about 40 px tall) to the ledge, over the top of the panel. */
const ARC = {
  from: { x: GIANT_X + 2, y: GROUND - 40 },
  control: { x: 0, y: -140 },
  to: { x: 30, y: LEDGE.y },
} as const;

function arcPoint(t: number): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * ARC.from.x + 2 * u * t * ARC.control.x + t * t * ARC.to.x,
    y: u * u * ARC.from.y + 2 * u * t * ARC.control.y + t * t * ARC.to.y,
  };
}
