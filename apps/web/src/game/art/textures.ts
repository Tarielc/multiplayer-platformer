import type * as Phaser from 'phaser';

/**
 * Procedural placeholder art, drawn on canvases and registered with `textures.addCanvas`,
 * so the template boots with zero external assets. Replace any key with a loaded image of
 * the same name (e.g. `this.load.image('coin', 'assets/sprites/coin.png')`) to reskin.
 * Characters come from a sprite sheet instead (see `characters/characterArt.ts`).
 */
export const TEXTURES = {
  coin: 'coin',
  gem: 'gem',
  flagDown: 'flag-down',
  flagUp: 'flag-up',
  door: 'door',
  puff: 'puff',
  marker: 'marker',
  lava: 'lava',
  danger: 'danger',
  bgFar: 'bg-far',
  bgNear: 'bg-near',
} as const;

type Draw = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

function canvasTexture(scene: Phaser.Scene, key: string, width: number, height: number, draw: Draw): void {
  if (scene.textures.exists(key)) return;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  draw(ctx, width, height);
  scene.textures.addCanvas(key, canvas);
}

export function createProceduralTextures(scene: Phaser.Scene): void {
  canvasTexture(scene, TEXTURES.coin, 16, 16, (ctx) => {
    ctx.fillStyle = '#a86f00';
    ctx.beginPath();
    ctx.arc(8, 8, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(8, 8, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffeaa0';
    ctx.fillRect(6, 4, 2, 8);
    ctx.fillStyle = '#d99a00';
    ctx.fillRect(9, 5, 2, 6);
  });

  canvasTexture(scene, TEXTURES.gem, 18, 18, (ctx) => {
    const diamond = (inset: number) => {
      ctx.beginPath();
      ctx.moveTo(9, inset);
      ctx.lineTo(18 - inset, 9);
      ctx.lineTo(9, 18 - inset);
      ctx.lineTo(inset, 9);
      ctx.closePath();
      ctx.fill();
    };
    ctx.fillStyle = '#1b6f9e';
    diamond(0.5);
    ctx.fillStyle = '#5ee7ff';
    diamond(2.5);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(6, 6, 3, 3);
  });

  const flag = (up: boolean): Draw => (ctx, w, h) => {
    ctx.fillStyle = '#5a5f7a';
    ctx.fillRect(3, 2, 3, h - 4);
    ctx.fillStyle = '#3b3f55';
    ctx.fillRect(0, h - 4, 10, 4);
    ctx.fillStyle = up ? '#7ee081' : '#9aa0c3';
    const top = up ? 4 : h - 22;
    ctx.beginPath();
    ctx.moveTo(6, top);
    ctx.lineTo(w, top + 7);
    ctx.lineTo(6, top + 14);
    ctx.closePath();
    ctx.fill();
  };
  canvasTexture(scene, TEXTURES.flagDown, 24, 64, flag(false));
  canvasTexture(scene, TEXTURES.flagUp, 24, 64, flag(true));

  canvasTexture(scene, TEXTURES.door, 32, 64, (ctx, w, h) => {
    ctx.fillStyle = '#5b3a1e';
    ctx.beginPath();
    ctx.roundRect(1, 4, w - 2, h - 4, [14, 14, 0, 0]);
    ctx.fill();
    ctx.fillStyle = '#20263f';
    ctx.beginPath();
    ctx.roundRect(5, 8, w - 10, h - 8, [10, 10, 0, 0]);
    ctx.fill();
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    // A star over the doorway marks the exit.
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 6 : 2.6;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = w / 2 + Math.cos(a) * r;
      const py = 22 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(w - 11, h - 26, 3, 3);
  });

  canvasTexture(scene, TEXTURES.puff, 8, 8, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(4, 4, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });

  canvasTexture(scene, TEXTURES.marker, 10, 7, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(10, 0);
    ctx.lineTo(5, 7);
    ctx.closePath();
    ctx.fill();
  });

  // Tileable (period 32) lava for hazard zones with `style: lava`.
  canvasTexture(scene, TEXTURES.lava, 32, 32, (ctx, w, h) => {
    ctx.fillStyle = '#c2280f';
    ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x++) {
      const crest = 5 + Math.round(2 * Math.sin((x / w) * Math.PI * 2));
      ctx.fillStyle = '#ff7a1a';
      ctx.fillRect(x, crest, 1, 4);
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(x, crest - 2, 1, 2);
    }
    ctx.fillStyle = 'rgba(255, 210, 63, 0.55)';
    ctx.fillRect(6, 17, 4, 3);
    ctx.fillRect(21, 24, 5, 3);
  });

  canvasTexture(scene, TEXTURES.danger, 32, 32, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(40, 10, 16, 0.7)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255, 93, 115, 0.75)';
    for (let i = -h; i < w; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, h);
      ctx.lineTo(i + 8, h);
      ctx.lineTo(i + 8 + h, 0);
      ctx.lineTo(i + h, 0);
      ctx.closePath();
      ctx.fill();
    }
  });

  // Parallax hills: horizontally tileable (all sine periods divide the width).
  const hills =
    (color: string, base: number, amps: [number, number, number]): Draw =>
    (ctx, w, h) => {
      ctx.fillStyle = color;
      for (let x = 0; x < w; x++) {
        const t = (x / w) * Math.PI * 2;
        const y = base - amps[0] * Math.sin(t) - amps[1] * Math.sin(t * 3 + 1) - amps[2] * Math.sin(t * 7 + 2);
        ctx.fillRect(x, Math.round(y), 1, h - Math.round(y));
      }
    };
  canvasTexture(scene, TEXTURES.bgFar, 512, 360, hills('rgba(32, 44, 92, 0.55)', 90, [34, 16, 6]));
  canvasTexture(scene, TEXTURES.bgNear, 512, 320, hills('rgba(24, 64, 72, 0.6)', 70, [18, 12, 5]));
}
