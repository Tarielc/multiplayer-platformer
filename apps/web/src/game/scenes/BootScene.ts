import * as Phaser from 'phaser';
import { createProceduralTextures } from '../art/textures';
import { VIEW_CONFIG } from '../config';
import type { GameServices } from '../services';
import { listen } from '../util/listen';
import { SCENE_KEYS } from './keys';

/** Generates placeholder textures, then waits for the room to have a level and starts it. */
export class BootScene extends Phaser.Scene {
  private started = false;

  constructor(private readonly services: GameServices) {
    super({ key: SCENE_KEYS.boot });
  }

  init(): void {
    this.started = false;
  }

  create(): void {
    createProceduralTextures(this);
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
}
