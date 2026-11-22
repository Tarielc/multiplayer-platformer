import type * as Phaser from 'phaser';
import { allAbilitySheets, frameName, type AbilityAnimDef, type AbilitySheetDef } from './abilityArt';

const jsonKey = (key: string) => `${key}:json`;

/** Loaded sheet descriptions, by texture key (global to the game, like textures). */
const registry = new Map<string, AbilitySheetDef>();

/** Queues every ability sheet (PNG + JSON) that isn't loaded yet. */
export function queueAbilitySheets(scene: Phaser.Scene, assetBase: string): void {
  for (const sheet of allAbilitySheets()) {
    if (scene.textures.exists(sheet.key)) continue;
    scene.load.image(sheet.key, `${assetBase}/${sheet.path}.png`);
    scene.load.json(jsonKey(sheet.key), `${assetBase}/${sheet.path}.json`);
  }
}

/**
 * Adds one named texture frame per animation frame (`anim:i`). Sheets that failed to load are
 * simply missing: ability views then fall back to the normal character clips. Returns the keys
 * that are missing.
 */
export function registerAbilitySheets(scene: Phaser.Scene): string[] {
  const missing: string[] = [];
  for (const sheet of allAbilitySheets()) {
    const def = scene.cache.json.get(jsonKey(sheet.key)) as AbilitySheetDef | undefined;
    if (!def || !scene.textures.exists(sheet.key)) {
      missing.push(sheet.path);
      continue;
    }
    registry.set(sheet.key, def);
    const texture = scene.textures.get(sheet.key);
    for (const [name, anim] of Object.entries(def.animations)) {
      anim.rects.forEach(([x, y, w, h], i) => {
        const frame = frameName(name, i);
        if (!texture.has(frame)) texture.add(frame, 0, x, y, w, h);
      });
    }
  }
  return missing;
}

export function abilitySheet(key: string): AbilitySheetDef | null {
  return registry.get(key) ?? null;
}

export function abilityAnim(key: string, anim: string): AbilityAnimDef | null {
  return registry.get(key)?.animations[anim] ?? null;
}
