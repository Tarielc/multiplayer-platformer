/**
 * Proves every shipped level can be finished by one player without losing a heart.
 *
 * A best-first search over "macro" moves (run, jump with different holds and steering, double
 * jump, wait, attack) on the real `GameWorld`, cloned at every node: traps, their timing, boxes, wind and
 * falling platforms are all simulated exactly as on the server. Each macro plays its inputs,
 * then neutral input until the player stands on something. Trampoline macros react to the
 * bounce: they double jump a set time after the launch and stop steering once they land. A branch ends when the player
 * dies or loses a heart; the search succeeds when the level completes.
 *
 * Co-op levels are built around puzzles that need a team (one player holds a button while
 * another uses what it switches), which a single player can't do. There the search plays as if
 * the team had done its part: every button counts as held, so traps linked to `on` buttons
 * work and traps linked to `off` buttons are gone. That still proves the layout is passable.
 * `--assume-buttons` does the same for any level; `--as-is` turns it off, to check that one
 * player alone really can't get through a co-op level.
 *
 * Usage: npm run levels:solve [-- --level race-2] [-- --verbose] [-- --assume-buttons | --as-is]
 * Exits with code 1 if a level can't be solved within the budget.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Button,
  GameWorld,
  isBoss,
  LEVELS,
  MOVEMENT_TUNING,
  PLAYER_CONFIG,
  parseManifestLevel,
  resolveMovement,
  type LevelData,
  type TrapDef,
} from '@platformer/shared';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'packages', 'shared', 'data');

const args = process.argv.slice(2);
const onlyLevel = args.includes('--level') ? args[args.indexOf('--level') + 1] : undefined;
const verbose = args.includes('--verbose');
const assumeButtons = args.includes('--assume-buttons');
const asIs = args.includes('--as-is');

/** Search budget per level. */
const MAX_EXPANSIONS = 60_000;
const MAX_SECONDS = Number(process.env.SOLVE_SECONDS ?? 240);
/** Neutral ticks a macro may wait to land before the branch is dropped (hovering in wind…). */
const MAX_SETTLE_TICKS = 300;

const { LEFT: L, RIGHT: R, JUMP: J, ATTACK: A } = Button;

interface Macro {
  name: string;
  inputs: number[];
  /** Played instead of the rest of `inputs` once a trampoline launches the player; the macro ends when they land. */
  onBounce?: number[];
}

/** Upward speed (px/s) above which a launch from a standstill or a fall counts as a trampoline bounce. Set per level. */
let bounceSpeed = Infinity;

const seq = (...parts: Array<[number, number]>): number[] => parts.flatMap(([buttons, ticks]) => Array<number>(ticks).fill(buttons));

const MACROS: Macro[] = [];
for (const [d, dir] of [
  ['R', R],
  ['L', L],
] as const) {
  for (const n of [5, 14, 30]) MACROS.push({ name: `run${d}${n}`, inputs: seq([dir, n]) });
  for (const hold of [6, 14, 26]) {
    for (const steer of [8, 16, 28, 60]) {
      MACROS.push({ name: `jump${d} h${hold} s${steer}`, inputs: seq([J | dir, Math.min(hold, steer)], [hold > steer ? J : dir, Math.abs(hold - steer)]) });
    }
  }
  // Running jumps cover the longest gaps; "late steer" jumps go straight up, then over a lip.
  MACROS.push({ name: `runJump${d}`, inputs: seq([dir, 12], [J | dir, 26], [dir, 40]) });
  MACROS.push({ name: `jump${d} late`, inputs: seq([J, 18], [J | dir, 8], [dir, 30]) });
  MACROS.push({ name: `attack${d}`, inputs: seq([dir | A, 1], [0, 16]) });
  // Double jumps: release, then press again near the apex (or early, or after going straight up).
  MACROS.push({ name: `doubleJump${d}`, inputs: seq([J | dir, 24], [dir, 1], [J | dir, 22], [dir, 40]) });
  MACROS.push({ name: `doubleJump${d} early`, inputs: seq([J | dir, 12], [dir, 1], [J | dir, 22], [dir, 30]) });
  MACROS.push({ name: `doubleJump${d} late`, inputs: seq([J, 24], [0, 1], [J, 10], [J | dir, 12], [dir, 30]) });
}
// Trampolines: hop onto one ahead, then double jump some time into the launch, steering.
for (const [d, dir] of [
  ['R', R],
  ['L', L],
] as const) {
  for (const approach of [0, 10, 24]) {
    for (const dj of [16, 26, 36]) {
      MACROS.push({
        name: `bounce${d} a${approach} dj${dj}`,
        inputs: seq([J | (approach ? dir : 0), 12], [approach > 12 ? dir : 0, Math.max(0, approach - 12)], [0, 60]),
        onBounce: seq([dir, dj], [J | dir, 22], [dir, 60]),
      });
    }
  }
}
MACROS.push({ name: 'jumpUp', inputs: seq([J, 26]) });
MACROS.push({ name: 'doubleJumpUp', inputs: seq([J, 24], [0, 1], [J, 22]) });
for (const n of [12, 30, 60]) MACROS.push({ name: `wait${n}`, inputs: seq([0, n]) });

interface Node {
  world: GameWorld;
  path: string[];
  ticks: number;
  priority: number;
}

/** Binary min-heap on `priority`. */
class Queue {
  private readonly items: Node[] = [];
  get size(): number {
    return this.items.length;
  }
  push(node: Node): void {
    const a = this.items;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.priority <= a[i]!.priority) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): Node | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.priority < a[m]!.priority) m = l;
        if (r < a.length && a[r]!.priority < a[m]!.priority) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

type Outcome = { kind: 'won' } | { kind: 'lost'; reason: string } | { kind: 'ok' };

/** Plays one macro on `world` (mutated). */
function play(world: GameWorld, macro: Macro): Outcome {
  const player = world.getPlayer('solo')!;
  const step = (buttons: number): Outcome | null => {
    world.stepPlayer('solo', buttons);
    world.endTick();
    for (const event of world.drainEvents()) {
      if (event.type === 'levelComplete') return { kind: 'won' };
      if (event.type === 'death') return { kind: 'lost', reason: `death (${event.cause})` };
      if (event.type === 'trapHit') return { kind: 'lost', reason: 'trap hit' };
    }
    if (player.hp < PLAYER_CONFIG.maxHp) return { kind: 'lost', reason: 'hurt' };
    return null;
  };
  let inputs = macro.inputs;
  let bounced = -1;
  for (let i = 0; i < inputs.length; i++) {
    const vy = player.body.vy;
    const outcome = step(inputs[i]!);
    if (outcome) return outcome;
    if (macro.onBounce && bounced < 0 && vy >= 0 && player.body.vy < -bounceSpeed) {
      inputs = macro.onBounce;
      i = -1;
      bounced = 0;
      continue;
    }
    if (bounced >= 0 && ++bounced > 5 && player.body.grounded) break;
  }
  for (let t = 0; t < MAX_SETTLE_TICKS; t++) {
    if (player.body.grounded) return { kind: 'ok' };
    const outcome = step(0);
    if (outcome) return outcome;
  }
  return { kind: 'lost', reason: 'never landed' };
}

function exitDistance(level: LevelData, world: GameWorld): number {
  const body = world.getPlayer('solo')!.body;
  const cx = body.x + PLAYER_CONFIG.hitbox.width / 2;
  const cy = body.y + PLAYER_CONFIG.hitbox.height / 2;
  let best = Infinity;
  for (const exit of level.exits) {
    const dx = Math.max(exit.x - cx, 0, cx - (exit.x + exit.width));
    const dy = Math.max(exit.y - cy, 0, cy - (exit.y + exit.height));
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

/** Positions are bucketed; traps add their replicated state and a coarse time phase. */
function stateKey(world: GameWorld, timed: boolean): string {
  const body = world.getPlayer('solo')!.body;
  const traps = world.trapField.toNet().map((t) => `${t.id}:${t.hits ?? ''}${t.pressed ? 'p' : ''}`).join(',');
  const phase = timed ? Math.floor(world.tick / 20) % 9 : 0;
  return `${Math.round(body.x / 4)},${Math.round(body.y / 4)},${Math.round(body.vx / 60)},${traps},${phase}`;
}

function solve(level: LevelData, movement: ReturnType<typeof resolveMovement>): boolean {
  const started = Date.now();
  // A boss keeps the exit shut until it is beaten, which the search can't plan for: with one in
  // the level, foes are left out and only the layout is checked.
  const boss = level.foes.some((f) => isBoss(f.kind));
  if (boss) console.log('  (boss level: foes left out, checking the layout only)');
  const start = new GameWorld({ level, movement, ...(boss ? { foes: null } : {}) });
  bounceSpeed = movement.jumpVelocity * 1.15;
  // Trampoline moves only where there is a trampoline: fewer branches everywhere else.
  const macros = level.traps.some((t) => t.kind === 'trampoline') ? MACROS : MACROS.filter((m) => !m.onBounce);
  start.addPlayer('solo', 0);
  // Moving traps make the same spot safe or deadly depending on when you get there.
  const timed = level.traps.some((t) => t.kind !== 'spikes' && t.kind !== 'box' && t.kind !== 'trampoline');
  const settle = play(start, { name: 'spawn', inputs: [] });
  if (settle.kind !== 'ok') {
    console.log(`  ✗ the spawn is not safe (${settle.kind === 'lost' ? settle.reason : settle.kind})`);
    return false;
  }

  const seen = new Set<string>([stateKey(start, timed)]);
  const queue = new Queue();
  queue.push({ world: start, path: [], ticks: 0, priority: exitDistance(level, start) });
  let expanded = 0;
  let closest = Infinity;
  let closestPath: string[] = [];
  const losses = new Map<string, number>();

  while (queue.size > 0) {
    if (expanded >= MAX_EXPANSIONS || (Date.now() - started) / 1000 > MAX_SECONDS) break;
    const node = queue.pop()!;
    expanded++;
    for (const macro of macros) {
      const world = node.world.clone();
      const before = world.tick;
      const outcome = play(world, macro);
      const body = world.getPlayer('solo')!.body;
      // Each move is listed with the tile the player ends up on.
      const where = `(${Math.floor((body.x + PLAYER_CONFIG.hitbox.width / 2) / level.tileSize)}, ${Math.floor((body.y + PLAYER_CONFIG.hitbox.height - 1) / level.tileSize)})`;
      const path = [...node.path, `${macro.name} ${outcome.kind === 'won' ? '→ exit' : where}`];
      const ticks = node.ticks + (world.tick - before);
      if (outcome.kind === 'won') {
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        console.log(
          `  ✓ finished in ${path.length} moves, ${(ticks / 60).toFixed(1)} s of play, 0 hearts lost (${expanded} nodes, ${seen.size} states, ${secs}s)`,
        );
        if (verbose) for (const [i, move] of path.entries()) console.log(`    ${String(i + 1).padStart(2)}. ${move}`);
        return true;
      }
      if (outcome.kind === 'lost') {
        losses.set(outcome.reason, (losses.get(outcome.reason) ?? 0) + 1);
        continue;
      }
      const key = stateKey(world, timed);
      if (seen.has(key)) continue;
      seen.add(key);
      const distance = exitDistance(level, world);
      if (distance < closest) {
        closest = distance;
        closestPath = path;
      }
      queue.push({ world, path, ticks, priority: distance + path.length * 6 });
    }
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const why = [...losses].sort((a, b) => b[1] - a[1]).map(([reason, n]) => `${reason} ×${n}`).join(', ');
  console.log(`  ✗ no way to the exit found: closest ${Math.round(closest)} px away (${expanded} nodes, ${seen.size} states, ${secs}s)`);
  console.log(`    branches lost to: ${why || 'nothing'}`);
  if (verbose) for (const [i, move] of closestPath.entries()) console.log(`    ${String(i + 1).padStart(2)}. ${move}`);
  return false;
}

/**
 * The level as if every button were held: buttons are removed, traps they switch `off` are
 * removed too, and traps they switch `on` are left unlinked (so always on).
 */
function withButtonsHeld(level: LevelData): LevelData {
  const buttons = level.traps.filter((t): t is Extract<TrapDef, { kind: 'button' }> => t.kind === 'button');
  if (buttons.length === 0) return level;
  const off = new Set(buttons.filter((b) => b.action === 'off').flatMap((b) => b.targets));
  return { ...level, traps: level.traps.filter((t) => t.kind !== 'button' && !off.has(t.id)) };
}

let failed = false;
for (const entry of LEVELS.entries) {
  if (onlyLevel && entry.id !== onlyLevel) continue;
  const json: unknown = JSON.parse(readFileSync(join(dataDir, entry.map), 'utf8'));
  const { level, issues } = parseManifestLevel(json, entry);
  console.log(`${entry.id} "${entry.name}" (${level?.traps.length ?? 0} traps)`);
  if (!level) {
    for (const issue of issues) console.log(`  [${issue.severity}] ${issue.message}`);
    failed = true;
    continue;
  }
  const team = assumeButtons || (entry.mode === 'coop' && !asIs);
  if (team && level.traps.some((t) => t.kind === 'button')) console.log('  (team puzzles: every button counts as held)');
  if (!solve(team ? withButtonsHeld(level) : level, resolveMovement(MOVEMENT_TUNING, entry.tuning))) failed = true;
}
if (failed) process.exitCode = 1;
