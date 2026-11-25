/**
 * The race campaign (also solo play). Every level splits into several routes that rejoin at
 * checkpoints (a racer's own in a race): a fast, risky one and a slower, safer one. Every
 * obstacle can be passed alone, without abilities or a teammate. Buttons here are held by a
 * box at the start: smash the box and the trap switches, which is a way to cut off the racers
 * behind you.
 */
import { Sketch, arc, controlSigns, frame } from './sketch';

/**
 * Sunny Sprint: grass, wood platforms, bronze blocks. Spikes, a trampoline, boxes, a box on a
 * button, a fan; mushrooms and chickens.
 *   1. From the start hill: the treetops (floating islands, gaps to jump) or down into the dell
 *      (spikes, mushrooms, a trampoline back up).
 *   2. The big hill: over its rolling crest, or through the burrow under it, where a sturdy box
 *      blocks a crawlway (smash it: 3 hits).
 *   3. The gorge: the sky bridge (lifted by a fan, or bounced up by a trampoline a box holds
 *      on), or across its floor and up the bronze steps to the trophy's mesa.
 */
export function race1(): Sketch {
  const s = new Sketch(330, 54);
  frame(s);
  // Start hill.
  s.ground(2, 34, 26);
  s.text(5, 25, '1 2 3 4');
  arc(s, 4, 24, 'a', [3, 4, 4, 3]);
  controlSigns(s, 26, { box: 29 });
  // 1a. The treetops: floating islands and a wood platform up to the hill's crest.
  for (const [x, y, w, fruit] of [
    [40, 21, 8, 's s'],
    [53, 17, 7, 'a a'],
    [65, 21, 6, 's'],
    [76, 16, 8, 'p p'],
    [90, 19, 7, 's s'],
  ] as const) {
    s.solid('grass', x, y, w, 3).text(x + 2, y - 1, fruit);
  }
  s.foe('chicken', 79, 15, { range: 2 });
  s.platform('woodPlatform', 101, 18, 5).text(102, 17, 'a');
  // 1b. The dell: a step down, spikes, a bronze ruin, boxes and foes; a trampoline back up to
  //     the crest, or straight on into the burrow.
  s.ground(35, 44, 34);
  s.ground(45, 107, 44);
  s.spikes(52, 43, 3);
  s.foe('mushroom', 59, 43, { range: 3 });
  s.block('bronzeBlock', 66, 42, 2, 2).text(66, 40, 'a');
  s.box(71, 43, 2);
  s.spikes(77, 43, 4);
  s.foe('chicken', 86, 43, { range: 3 });
  s.block('bronzeBlock', 92, 40, 1, 4).text(92, 38, 's');
  s.trampoline(100, 43);
  // 2. The big hill (crest row 28) with the burrow through it at the dell's level.
  s.ground(108, 199, 28);
  s.carve(127, 28, 12, 3).text(130, 30, 'a s a');
  s.foe('mushroom', 133, 30, { range: 3 });
  s.solid('grass', 148, 24, 14, 4).text(151, 23, 'p p p');
  s.spikes(166, 27, 3);
  s.foe('chicken', 175, 27, { range: 4 });
  s.block('bronzeBlock', 184, 26, 2, 2);
  s.platform('woodPlatform', 179, 20, 6).text(180, 19, 'w');
  // The burrow: a cave, a crawlway 2 tiles tall (no jumping the box), a cavern, a low tunnel out.
  s.carve(108, 39, 22, 5);
  s.carve(130, 42, 12, 2);
  s.box(135, 43, 3);
  s.carve(142, 37, 32, 7).text(150, 40, 's a s');
  s.foe('mushroom', 160, 43, { range: 4 });
  s.block('bronzeBlock', 166, 40, 2, 4).text(166, 38, 'a');
  s.carve(174, 40, 26, 4);
  // 3. The routes meet on a ledge over the gorge.
  s.ground(200, 205, 44);
  s.ground(206, 216, 36);
  s.text(208, 35, 'C');
  // The gorge: a fan and a box-held trampoline up to the sky bridge, or the floor and steps.
  s.ground(217, 287, 49);
  s.fan(221, 48, { range: 19 });
  for (const [x, y] of [
    [224, 31],
    [236, 30],
    [249, 31],
    [262, 30],
    [275, 31],
  ] as const) {
    s.platform('woodPlatform', x, y, 8).text(x + 2, y - 1, 'a a');
  }
  s.foe('mushroom', 229, 48, { range: 3 });
  s.spikes(233, 48, 3);
  const lift = s.nextName('trampoline');
  s.trampoline(244, 48);
  s.box(239, 48, 3);
  s.button(239, 48, lift);
  s.spikes(252, 48, 4);
  s.foe('chicken', 260, 48, { range: 4 });
  s.block('bronzeBlock', 268, 47, 2, 2);
  s.block('bronzeBlock', 274, 43, 2, 6);
  s.block('bronzeBlock', 280, 37, 2, 12);
  // The mesa: a last island above it, and the trophy.
  s.ground(288, 327, 31);
  s.solid('grass', 298, 20, 12, 3).text(301, 19, 'w g w');
  s.foe('mushroom', 305, 30, { range: 4 });
  s.text(320, 30, 'E');
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
 * spike-heads, bulls. Two routes up to the spire:
 *   - the candy gardens along the bottom: bull pits, spike-heads on the hills, and terraces up;
 *   - the jade tower over them, three galleries rising like stairs, each with lava trenches
 *     crossed by riding a rock-head, then a gold bridge out.
 * They meet under the spire: platforms stack up its face to the summit, where a spiked corridor is held
 * safe by a box on its button (smash it and the spikes bite whoever comes next), or the long
 * way climbs over the corridor's roof.
 */
export function race3(): Sketch {
  const s = new Sketch(380, 80);
  frame(s);
  s.ground(2, 44, 70, 'candy');
  s.text(5, 69, '1 2 3 4');
  arc(s, 4, 69, 'a', [3, 4, 4, 3]);
  // The gardens: a bull pit, a hill with spike-heads, a valley, a mesa, then terraces.
  s.ground(45, 78, 76, 'candy');
  s.foe('bull', 62, 75, { range: 8 });
  s.block('goldBlock', 75, 74, 2, 2);
  s.ground(79, 120, 68, 'candy');
  s.spikeHead(90, 65);
  s.text(97, 67, 'a a');
  s.spikeHead(106, 65);
  s.ground(121, 170, 74, 'candy');
  s.block('goldBlock', 132, 70, 2, 4).text(132, 68, 's');
  s.foe('bull', 146, 73, { range: 10 });
  s.spikeHead(158, 71);
  s.block('goldBlock', 166, 72, 2, 2);
  s.ground(171, 235, 66, 'candy');
  s.spikeHead(185, 63);
  s.foe('bull', 205, 65, { range: 10 });
  s.text(222, 65, 'p');
  s.ground(236, 247, 62, 'candy');
  s.ground(248, 257, 56, 'candy');
  s.ground(258, 267, 50, 'candy');
  // The jade tower: gold platforms from the start up to its open end, then three galleries,
  // each a step higher (floor slabs and roofs 3 thick, the roofs joined by jade risers).
  s.platform('goldPlatform', 46, 64, 5).text(47, 63, 'a');
  s.platform('goldPlatform', 53, 59, 5);
  const galleries = [
    [60, 129, 56],
    [130, 189, 50],
    [190, 235, 44],
  ] as const;
  for (const [x0, x1, floor] of galleries) {
    s.solid('jadeWall', x0, floor, x1 - x0 + 1, 3);
    s.solid('jadeWall', x0, floor - 16, x1 - x0 + 1, 3);
  }
  s.solid('jadeWall', 128, 34, 2, 6);
  s.solid('jadeWall', 188, 28, 2, 6);
  // Trenches: lava between stone pillars, a rock-head sliding across (it waits at each end).
  for (const [x, floor] of [
    [66, 56],
    [100, 56],
    [158, 50],
    [202, 44],
  ] as const) {
    s.solid('stoneWall', x - 2, floor - 4, 2, 4).solid('stoneWall', x + 22, floor - 4, 2, 4);
    s.rockHead(x, floor - 4, 'x', { waitMs: 1000, phaseMs: (x * 37) % 900 });
    s.lava(x, x + 21, floor - 1);
    s.text(x + 10, floor - 8, 'p');
  }
  s.platform('goldPlatform', 136, 45, 6).text(137, 44, 's s');
  s.foe('bull', 144, 49, { range: 6 });
  // The gold bridge out of the tower, over the terraces.
  for (const x of [238, 248, 258]) s.platform('goldPlatform', x, 44, 6);
  // The spire: a jade overhang, a bull on the landing, then gold platforms stacked against the
  // summit's face (one-way, so each is a jump up through the next) to the top.
  s.ground(268, 315, 44, 'candy');
  s.text(270, 43, 'C');
  s.solid('jadeWall', 268, 2, 30, 10);
  s.foe('bull', 280, 43, { range: 8 });
  s.block('goldBlock', 296, 42, 2, 2).text(296, 41, 'a');
  s.platform('goldPlatform', 307, 39, 9).text(309, 38, 'a');
  s.platform('goldPlatform', 310, 34, 6).text(312, 33, 's');
  s.platform('goldPlatform', 306, 29, 10).text(308, 28, 'a');
  s.ground(316, 377, 22, 'candy');
  // The summit: a spiked corridor 3 tall (no jumping 21 tiles of spikes) held safe by a box on
  // its button, or gold blocks up onto its roof.
  const spikes = s.nextName('spikes');
  s.spikes(332, 21, 21);
  s.box(328, 21, 3);
  s.button(328, 21, spikes, 'off');
  s.solid('stoneWall', 332, 8, 21, 11);
  s.block('goldBlock', 322, 18, 2, 4);
  s.block('goldBlock', 325, 12, 2, 2);
  s.text(337, 7, 'w w w');
  s.foe('bull', 362, 21, { range: 6 });
  s.text(372, 21, 'E');
  return s;
}
