/**
 * The race campaign (also solo play). Every level splits into several routes that rejoin at
 * checkpoints (a racer's own in a race): a fast, risky one and a slower, safer one. Every
 * obstacle can be passed alone, without abilities or a teammate. Buttons here are held by a
 * box at the start: smash the box and the trap switches, which is a way to cut off the racers
 * behind you.
 */
import { Sketch, arc, frame } from './sketch';

/**
 * Sunny Sprint: grass, wood platforms, bronze blocks. Spikes, a trampoline, boxes, a box on a
 * button, a fan; mushrooms and chickens.
 *   1. Low road (safe hills) or high road (a trampoline up to floating platforms, gaps to jump).
 *   2. Over the hill, or smash the 3-hit box in the tunnel under it (the corner cut).
 *   3. The floor (spikes) or the bridge, reached by a fan or by the box-powered trampoline.
 */
export function race1(): Sketch {
  const s = new Sketch(320, 50);
  frame(s);
  // Start; the trampoline to the high road is right ahead.
  s.ground(2, 120, 40);
  s.text(5, 39, '1 2 3 4');
  arc(s, 4, 39, 'a', [3, 4, 4, 3]);
  s.trampoline(26, 39);
  // 1a. High road: wood platforms 15-16 above the low road, out of its reach.
  for (const [x, y, n] of [
    [29, 24, 6],
    [40, 25, 5],
    [51, 24, 4],
    [61, 25, 5],
    [72, 24, 4],
    [82, 25, 6],
    [94, 24, 5],
    [106, 25, 6],
  ] as const) {
    s.platform('woodPlatform', x, y, n).text(x + 1, y - 1, 's');
  }
  // 1b. Low road: spikes, bronze steps, boxes and foes.
  s.box(34, 39, 1);
  s.spikes(44, 39, 3);
  s.foe('mushroom', 55, 39, { range: 3 });
  s.block('bronzeBlock', 62, 38, 2, 2).text(62, 36, 'a');
  s.spikes(70, 39, 4);
  s.foe('mushroom', 84, 39, { range: 3 });
  s.box(90, 39, 2);
  s.block('bronzeBlock', 96, 36, 1, 4).text(96, 34, 'a');
  s.foe('chicken', 104, 39, { range: 4 });
  s.spikes(110, 39, 3);
  // Both roads meet on the plateau.
  s.ground(121, 316, 34);
  s.text(124, 33, 'C');
  // 2. The hill: climb over it, or smash the sturdy box in the tunnel underneath (2 tiles tall:
  //    no jumping the box).
  s.block('bronzeBlock', 146, 30, 2, 4);
  s.block('bronzeBlock', 149, 26, 2, 2);
  s.solid('grass', 153, 22, 46, 10);
  s.box(156, 33, 3);
  arc(s, 160, 21, 'a', [2, 3, 3, 2]);
  s.foe('chicken', 172, 21, { range: 4 });
  s.foe('mushroom', 186, 21, { range: 4 });
  s.text(176, 33, 'p');
  s.text(206, 33, 'C');
  // 3. The floor, or the bridge 13 up: lifted by a fan, or bounced by a trampoline powered by a
  //    box on its button (smash the box to switch it off behind you).
  s.fan(233, 33, { range: 14 });
  for (const [x, n] of [
    [236, 10],
    [250, 8],
    [262, 10],
    [276, 8],
    [288, 10],
  ] as const) {
    s.platform('woodPlatform', x, 21, n).text(x + 2, 20, 'a');
  }
  s.spikes(245, 33, 3);
  s.foe('mushroom', 255, 33, { range: 3 });
  const lift = s.nextName('trampoline');
  s.trampoline(266, 33);
  s.box(260, 33, 3);
  s.button(260, 33, lift);
  s.spikes(278, 33, 4);
  s.foe('chicken', 292, 33, { range: 3 });
  s.text(308, 33, 'E');
  return s;
}

/**
 * Ember Gorge: autumn ground, brick, wood walls, copper blocks, metal platforms. Saws, falling
 * platforms, lava, fans; wasps and monkeys. Three routes from the start:
 *   - the canyon: pillars and falling platforms over a lava-covered roof (fastest, riskiest);
 *   - the cliffs: a fan up to wood ledges under the ceiling, monkeys on hanging pillars;
 *   - the mine: down a shaft into a tunnel under the roof, saws dropping from its ceiling on a
 *     beat (slowest, safest).
 * They meet past the mine's exit shaft; then saws over copper stepping stones, or metal
 * platforms above them, to the trophy.
 */
export function race2(): Sketch {
  const s = new Sketch(360, 60);
  frame(s);
  s.ground(2, 33, 24, 'autumn');
  s.text(5, 23, '1 2 3 4');
  arc(s, 4, 23, 'a', [3, 4, 4, 3]);
  // The mine: a shaft, a tunnel (rows 43-46) under a brick roof, the exit shaft at the far end.
  s.ground(34, 36, 36, 'autumn');
  s.ground(37, 249, 47, 'autumn');
  s.solid('brick', 40, 38, 201, 5);
  for (const [x, phase] of [
    [58, 0],
    [84, 600],
    [110, 1200],
    [136, 300],
    [162, 900],
    [188, 0],
    [214, 600],
  ] as const) {
    s.saw(x, 41, x, 45, { speed: 50, phaseMs: phase });
    s.text(x + 6, 46, 'a');
  }
  s.platform('metalPlatform', 241, 41, 4);
  s.platform('metalPlatform', 245, 35, 4);
  s.platform('metalPlatform', 241, 29, 4);
  // The canyon: autumn pillars and falling platforms; lava covers the roof between them.
  const pillars = [44, 64, 84, 104, 116, 139, 160, 172, 193, 212, 233];
  for (const x of pillars) s.solid('autumn', x, 24, 6, 14).text(x + 2, 23, 's');
  for (const x of [54, 59, 94, 99, 127, 150, 155, 183, 188, 223, 228]) s.fallingPlatform(x, 24);
  s.platform('metalPlatform', 75, 24, 4);
  s.platform('metalPlatform', 132, 22, 4);
  s.platform('metalPlatform', 204, 23, 5);
  s.platform('metalPlatform', 243, 24, 4);
  s.lava(40, 240, 37);
  s.wasp(70, 17, { range: 4 });
  s.wasp(146, 16, { range: 4 });
  s.wasp(218, 17, { range: 4 });
  // The cliffs: a fan from the start up to wood ledges, monkeys on pillars hanging from the ceiling.
  s.fan(26, 23, { range: 15 });
  for (const [x, y, n] of [
    [33, 11, 14],
    [53, 13, 14],
    [73, 10, 12],
    [92, 12, 14],
    [112, 11, 14],
    [133, 13, 12],
    [150, 7, 12],
    [170, 10, 14],
    [190, 12, 14],
    [210, 11, 14],
    [230, 13, 10],
  ] as const) {
    s.solid('woodWall', x, y, n, 2).text(x + 3, y - 1, 'p');
  }
  s.solid('woodWall', 108, 2, 2, 8);
  s.monkey(107, 9, 'right', { range: 3 });
  s.solid('woodWall', 186, 2, 2, 6);
  s.monkey(185, 7, 'right', { range: 2 });
  // Rejoin, then the finale over a lava trench: copper stepping stones swept by saws, or metal
  // platforms above them with a wasp.
  s.ground(250, 270, 24, 'autumn');
  s.text(253, 23, 'C');
  s.ground(271, 330, 40, 'autumn');
  s.lava(271, 330, 39);
  for (const [x, y] of [
    [276, 30],
    [284, 31],
    [292, 30],
    [300, 31],
    [308, 30],
    [316, 31],
    [324, 30],
  ] as const) {
    s.block('copperBlock', x, y, 2, 2);
  }
  s.saw(280, 27, 296, 27, { speed: 90 });
  s.saw(304, 27, 320, 27, { speed: 90, phaseMs: 1000 });
  for (const [x, y] of [
    [272, 18],
    [284, 17],
    [296, 18],
    [308, 17],
    [320, 18],
  ] as const) {
    s.platform('metalPlatform', x, y, 6).text(x + 2, y - 1, 'w');
  }
  s.wasp(302, 12, { range: 3 });
  s.ground(331, 357, 24, 'brick');
  s.text(350, 23, 'E');
  return s;
}

/**
 * Candy Spire: candy ground, jade and stone walls, gold blocks and platforms. Rock-heads,
 * spike-heads, bulls. Two routes to the summit:
 *   - the outer track along the ground, past spike-heads and bulls, then up candy terraces;
 *   - the jade tower above it: lava trenches crossed by riding rock-heads.
 * On the summit, a spiked corridor whose spikes a box holds switched off (smash it and they bite
 * whoever comes next), or the long way over the corridor's roof.
 */
export function race3(): Sketch {
  const s = new Sketch(400, 72);
  frame(s);
  s.ground(2, 249, 64, 'candy');
  s.text(5, 63, '1 2 3 4');
  arc(s, 4, 63, 'a', [3, 4, 4, 3]);
  // The outer track: spike-heads to jump, bulls to dodge.
  s.spikeHead(62, 61);
  s.foe('bull', 82, 63, { range: 8 });
  s.spikeHead(104, 61);
  s.block('goldBlock', 120, 60, 2, 4).text(120, 58, 'a');
  s.foe('bull', 150, 63, { range: 8 });
  s.spikeHead(178, 61);
  s.foe('bull', 210, 63, { range: 8 });
  s.spikeHead(232, 61);
  // Candy terraces up to the summit.
  s.ground(250, 259, 58, 'candy');
  s.ground(260, 269, 52, 'candy');
  s.ground(270, 279, 46, 'candy');
  s.ground(280, 289, 40, 'candy');
  s.spikeHead(283, 37);
  s.ground(290, 299, 34, 'candy');
  s.ground(300, 397, 28, 'candy');
  // The jade tower: gold platforms up to its floor, then lava trenches between jade pillars,
  // each crossed by riding a rock-head (it waits at each end).
  s.platform('goldPlatform', 43, 58, 5);
  s.platform('goldPlatform', 50, 52, 5);
  s.solid('jadeWall', 56, 46, 190, 3);
  s.solid('jadeWall', 56, 30, 190, 3);
  for (const x of [70, 110, 150, 190]) {
    s.solid('stoneWall', x - 2, 42, 2, 4).solid('stoneWall', x + 22, 42, 2, 4);
    s.rockHead(x, 42, 'x', { waitMs: 1000, phaseMs: (x * 37) % 900 });
    s.lava(x, x + 21, 45);
    s.text(x + 10, 38, 'p');
  }
  s.platform('goldPlatform', 247, 46, 22);
  s.text(255, 45, 's s s');
  // The summit: a spiked corridor (3 tall, no jumping 21 tiles of spikes) held safe by a box on
  // its button, or the long way over its roof.
  s.text(304, 27, 'C');
  const spikes = s.nextName('spikes');
  s.spikes(320, 27, 21);
  s.box(316, 27, 3);
  s.button(316, 27, spikes, 'off');
  s.solid('stoneWall', 320, 12, 21, 13);
  s.block('goldBlock', 310, 24, 2, 4);
  s.block('goldBlock', 314, 18, 2, 4);
  s.text(325, 11, 'w w w');
  s.foe('bull', 360, 27, { range: 6 });
  s.text(385, 27, 'E');
  return s;
}
