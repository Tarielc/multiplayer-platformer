// Production bundle: one ESM file with @platformer/shared inlined (it ships TypeScript source).
// `ws` stays external and is installed as a normal dependency.
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
  external: ['ws', 'bufferutil', 'utf-8-validate'],
  logLevel: 'info',
});
