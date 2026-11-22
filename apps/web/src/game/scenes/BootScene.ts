import * as Phaser from 'phaser';
import { createProceduralTextures } from '../art/textures';
import { prepareSoundCues, queueSoundOverrides } from '../audio/SoundController';
import { ensureCharacterSheet, registerCharacterAnimations } from '../characters/characterAnimations';
import { CHARACTER_SHEET } from '../characters/characterArt';
import { VIEW_CONFIG } from '../config';
import type { GameServices } from '../services';
import { ensureTrapSheets, queueTrapSheets, registerTrapAnimations } from '../traps/trapAnimations';
import { TRAP_SHEETS } from '../traps/trapArt';
import { listen } from '../util/listen';
import { SCENE_KEYS } from './keys';

/**
 * Loads game-wide assets once per game (character and trap sprite sheets, optional recorded
 * sounds), generates placeholder textures and synthesized sounds, registers animations, then
 * waits for the room to have a level and starts it.
 */
export class BootScene extends Phaser.Scene {
  private started = false;
  private failed = new Set<string>();

  constructor(private readonly services: GameServices) {
    super({ key: SCENE_KEYS.boot });
  }

  init(): void {
    this.started = false;
    this.failed = new Set();
  }

  preload(): void {
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, this.onLoadError);
    const { key, path, frameWidth, frameHeight } = CHARACTER_SHEET;
    if (!this.textures.exists(key)) {
      this.load.spritesheet(key, `${this.services.assetBase}/${path}`, { frameWidth, frameHeight });
    }
    queueTrapSheets(this, this.services.assetBase);
    queueSoundOverrides(this, this.services.assetBase);
  }

  create(): void {
    this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, this.onLoadError);
    createProceduralTextures(this);
    if (ensureCharacterSheet(this, this.failed.has(CHARACTER_SHEET.key))) {
      this.services.bridge.emit('level:warning', {
        message: `Character sprites (${CHARACTER_SHEET.path}) could not be loaded; using placeholders. Run "npm run assets:sync".`,
      });
    }
    registerCharacterAnimations(this);
    const missingTraps = ensureTrapSheets(this, this.failed);
    if (missingTraps.length > 0) {
      const files = missingTraps.map((name) => TRAP_SHEETS[name].path).join(', ');
      this.services.bridge.emit('level:warning', {
        message: `Trap sprites (${files}) could not be loaded; using placeholders. Run "npm run assets:sync".`,
      });
    }
    registerTrapAnimations(this);
    prepareSoundCues(this);

    this.add
      .text(VIEW_CONFIG.width / 2, VIEW_CONFIG.height / 2, 'Waiting for the level…', {
        fontFamily: VIEW_CONFIG.label.fontFamily,
        fontSize: '14px',
        color: '#9aa0c3',
      })
      .setOrigin(0.5);

    const { client } = this.services;
    const tryStart = () => {
      if (this.started || !client.room?.level) return;
      this.started = true;
      this.scene.start(SCENE_KEYS.level);
    };
    listen(this, client.events, 'room', tryStart);
    tryStart();
  }

  private readonly onLoadError = (file: Phaser.Loader.File) => {
    this.failed.add(file.key);
  };
}
