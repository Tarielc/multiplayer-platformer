// Production bundle: one ESM file with @platformer/shared inlined (it ships TypeScript source).
// `ws` and `mongodb` stay external and are installed as normal dependencies.
import { rmSync } from 'node:fs';
import { build } from 'esbuild';

rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external: ['ws', 'bufferutil', 'utf-8-validate', 'mongodb'],
  logLevel: 'info',
});
