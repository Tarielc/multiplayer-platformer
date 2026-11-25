/**
 * The co-op campaign (2+ players). Each level brings in new terrain, traps and foes, and is
 * built around the three team puzzles in `puzzles.ts`:
 *
 *   P1 Tandem Trampoline: one holds a button so a teammate can bounce up to a shelf, who then
 *      holds the shelf's button for them.
 *   P2 Spike Gauntlet: one holds a button at the entrance of a long spiked corridor while the
 *      others cross, and someone holds the one at the exit for them.
 *   P3 Lift-Off: an ability (frog spit, drone, or a jump off giant Mask Dude) gets someone up
 *      to a button ledge that powers the trampoline everyone else needs.
 *
 * Checkpoints are shared in co-op, so each puzzle has one just before it and the next one a
 * whole section after it: dying on purpose after a teammate crossed doesn't skip it for free.
 */
import { GAUNTLET_LENGTH, LIFT_CREST, TANDEM_SHELF, liftOff, spikeGauntlet, tandemTrampoline } from './puzzles';
import { Sketch, arc, frame } from './sketch';

/**
 * Meadow Gate (gentle): grass, wood platforms and bronze blocks. From the start hill down into a
 * meadow under floating islands, where a box holds a button that powers a trampoline up to them
 * (break it and the trampoline stops). P1 in its plainest form, then the hollow hill: over its
 * crest or down through the cave inside it. P2 through the mountain, a valley with a fruit perch
 * only a stacked teammate reaches, and the trophy's hill.
 */
export function coop1(): Sketch {
  const s = new Sketch(300, 56);
  frame(s);
  // 1. Start hill, then down into the meadow.
  s.ground(2, 30, 30);
  s.text(5, 29, '1 2 3 4');
  arc(s, 4, 29, 'a', [3, 4, 4, 3]);
  s.box(18, 29, 1).box(22, 29, 2).text(22, 25, 's');
  s.ground(31, 40, 36);
  s.ground(41, 79, 42);
  s.foe('chicken', 44, 41, { range: 3 });
  s.block('bronzeBlock', 48, 40, 2, 2).text(48, 38, 'a');
  // 2. The button lesson: a box rests on a button that powers a trampoline up to the islands.
  //    Break the box and the trampoline stops: a button only works while something holds it.
  const lesson = s.nextName('trampoline');
  s.box(54, 41, 3);
  s.button(54, 41, lesson);
  s.trampoline(60, 41);
  s.solid('grass', 63, 26, 10, 3).text(65, 25, 'w p w');
  s.solid('grass', 40, 18, 8, 3).text(42, 17, 's s');
  s.platform('woodPlatform', 51, 22, 6).text(52, 21, 'a a');
  s.block('bronzeBlock', 68, 40, 2, 2);
  s.text(74, 41, 'C');
  // 3. P1 down in a meadow pit: the shelf is the only way on.
  tandemTrampoline(s, 80, 48, { shelfEnd: 125 });
  s.text(84, 47, 'a a a a');
  s.foe('mushroom', 96, 47, { range: 3 });
  // 4. The hollow hill (crest row 32): over the top past spikes and mushrooms, or down the hole
  //    into the cave and up its far shaft on wood platforms.
  const hill = 48 - TANDEM_SHELF;
  s.ground(126, 200, hill);
  arc(s, 112, hill - 1, 'a', [2, 3, 3, 2]);
  s.foe('mushroom', 118, hill - 1, { range: 4 });
  s.carve(138, hill, 4, 4);
  s.carve(138, hill + 4, 46, 8).text(146, hill + 10, 's a s a s');
  s.foe('mushroom', 156, hill + 11, { range: 5 });
  s.block('bronzeBlock', 166, hill + 8, 2, 4).text(166, hill + 6, 'p');
  s.foe('mushroom', 174, hill + 11, { range: 3 });
  s.carve(184, hill, 4, 12);
  s.platform('woodPlatform', 184, hill + 8, 4).platform('woodPlatform', 184, hill + 4, 4).platform('woodPlatform', 184, hill, 4);
  s.solid('grass', 146, hill - 4, 14, 4).text(149, hill - 5, 'p p');
  s.spikes(142, hill - 1, 3);
  s.spikes(162, hill - 1, 4);
  s.foe('chicken', 172, hill - 1, { range: 3 });
  s.solid('grass', 158, 14, 10, 3).text(160, 13, 'w g w');
  s.platform('woodPlatform', 170, 22, 5).text(171, 21, 's');
  s.text(195, hill - 1, 'C');
  // 5. P2 through the brick mountain.
  s.ground(201, 262, hill);
  spikeGauntlet(s, 205, hill, { wall: 'brick' });
  // 6. Down into the valley, past a fruit perch 13 up (a lone jump falls short, a stacked
  //    teammate makes it), and up the bronze steps to the trophy's hill.
  const out = 205 + GAUNTLET_LENGTH;
  s.text(out + 5, hill - 1, 'a a');
  s.ground(263, 282, hill + 8);
  s.platform('woodPlatform', 268, hill - 5, 4).text(268, hill - 6, 'w g');
  s.foe('mushroom', 272, hill + 7, { range: 3 });
  s.block('bronzeBlock', 279, hill + 4, 2, 4);
  s.ground(283, 297, hill - 2);
  s.text(292, hill - 3, 'E');
  return s;
}

/**
 * Rust Canyon: autumn ground, brick, wood walls, copper and steel blocks, metal platforms.
 * New: saws, a fan, falling platforms, lava, a wasp and a monkey. A descent over a lava canyon on
 * falling platforms, a saw on the ledge, a fan shaft, P3 introduced in a calm pit, a monkey's
 * cliff, P1 with a saw sweeping the shelf, falling platforms over lava, and a long P2.
 */
export function coop2(): Sketch {
  const s = new Sketch(360, 60);
  frame(s);
  // 1. Start on a high autumn ledge.
  s.ground(2, 31, 20, 'autumn');
  s.text(5, 19, '1 2 3 4');
  arc(s, 4, 19, 'a', [3, 4, 4, 3]);
  // 2. Down the canyon: falling platforms and metal ledges over lava.
  s.ground(32, 77, 56, 'autumn');
  s.text(32, 55, 'L'.repeat(46));
  s.fallingPlatform(34, 24).text(34, 21, 's');
  s.platform('metalPlatform', 40, 28, 4).text(41, 27, 'a');
  s.fallingPlatform(47, 31).text(47, 28, 's');
  s.block('copperBlock', 52, 33, 2, 2).text(52, 31, 'a');
  s.fallingPlatform(58, 36).text(58, 33, 's');
  s.platform('metalPlatform', 63, 38, 5).text(64, 37, 'p');
  s.block('steelBlock', 72, 40, 2, 2);
  // 3. The ledge: a saw rides along it at body height; jump it. Then a fan up the brick cliff,
  //    a wasp at the top.
  s.ground(78, 93, 40, 'autumn');
  s.saw(81, 38, 89, 38, { speed: 70 });
  s.fan(91, 39, { range: 16 });
  s.ground(94, 105, 25, 'brick');
  s.wasp(101, 19, { range: 3 });
  s.text(98, 24, 'p');
  // 4. Brick steps down to the pit room's tunnel.
  s.ground(106, 111, 32, 'brick');
  s.ground(112, 117, 39, 'brick');
  s.ground(118, 123, 46, 'brick');
  s.text(119, 45, 'C');
  s.ground(124, 129, 52, 'autumn');
  // 5. P3: the button ledge by the left wall, the crest on the right. Fruit in the pit recharges
  //    abilities between tries.
  liftOff(s, 130, 52, { crestEnd: 168, crest: 'autumn', wall: 'woodWall', ledge: 'metalPlatform' });
  s.text(136, 51, 'a s a s a');
  s.text(147, 51, 'p');
  // 6. The lava chasm: metal platforms, a falling one and steel stepping stones under wood
  //    pillars hanging from the ceiling, where monkeys climb. Then the brick tower's top.
  const crest = 52 - LIFT_CREST;
  s.text(162, crest - 1, 's s');
  s.ground(169, 194, 56, 'autumn');
  s.lava(169, 194, 55);
  s.platform('metalPlatform', 171, 35, 4).text(172, 34, 'a');
  s.fallingPlatform(178, 33);
  s.solid('woodWall', 182, 2, 2, 20);
  s.monkey(181, 21, 'right', { range: 3 });
  s.platform('metalPlatform', 184, 31, 4).text(185, 30, 'a');
  s.block('steelBlock', 190, 28, 2, 2);
  s.solid('woodWall', 188, 2, 2, 14);
  s.monkey(190, 15, 'left', { range: 2 });
  s.ground(195, 214, crest - 12, 'brick');
  s.text(205, crest - 13, 'C');
  // 7. P1 with a saw sweeping the shelf: whoever holds the shelf button has to time it.
  const pit = crest - 6;
  tandemTrampoline(s, 215, pit, { shelfEnd: 256, shelf: 'brick', floor: 'autumn' });
  const shelf = pit - TANDEM_SHELF;
  s.saw(246, shelf - 2, 256, shelf - 2, { speed: 50 });
  s.text(222, pit - 1, 'a a');
  s.foe('mushroom', 230, pit - 1, { range: 3 });
  // 8. A step down, falling platforms stepping down over a lava pit, a checkpoint and the long
  //    P2 through the wooden mountain.
  s.ground(257, 270, shelf + 6, 'brick');
  s.text(262, shelf + 5, 'a');
  s.ground(271, 285, 40, 'autumn');
  s.lava(271, 285, 39);
  s.fallingPlatform(273, shelf + 9).fallingPlatform(277, shelf + 12).fallingPlatform(281, shelf + 15);
  s.text(277, shelf + 9, 'w');
  const gate = shelf + 18;
  s.ground(286, 357, gate, 'brick');
  s.text(288, gate - 1, 'C');
  spikeGauntlet(s, 296, gate, { length: 52, wall: 'woodWall' });
  s.text(353, gate - 1, 'E');
  return s;
}

/**
 * Jade Citadel: candy ground, jade and stone walls, gold blocks and platforms. New: rock-heads,
 * spike-heads, a bull. A climb from the candy gardens into the citadel: a gatehouse tunnel where
 * a rock-head slams wall to wall (don't get pinned), courtyards stepping up past spike-heads,
 * P3 among spike-heads, P2 through the stone mountain, down into a bull's arena ringed with gold
 * ledges, and P1 up to the summit with a spike-head by the pit button.
 */
export function coop3(): Sketch {
  const s = new Sketch(330, 76);
  frame(s);
  // 1. The candy gardens.
  s.ground(2, 44, 68, 'candy');
  s.text(5, 67, '1 2 3 4');
  arc(s, 4, 67, 'a', [3, 4, 4, 3]);
  s.platform('goldPlatform', 20, 62, 5).text(21, 61, 's s');
  s.platform('goldPlatform', 29, 57, 5).text(30, 56, 'p');
  // 2. The gatehouse: a jade keep with a tunnel through it; a rock-head slams across the
  //    tunnel between stone pillars. Cross while it waits, or ride it.
  s.ground(45, 72, 68, 'candy');
  s.solid('jadeWall', 45, 36, 28, 26);
  s.solid('stoneWall', 47, 66, 2, 2).solid('stoneWall', 69, 66, 2, 2);
  s.rockHead(52, 66, 'x', { waitMs: 1200 });
  s.text(58, 63, 's s s');
  s.solid('stoneWall', 45, 30, 4, 6).solid('stoneWall', 57, 30, 4, 6).solid('stoneWall', 69, 30, 4, 6);
  // 3. Courtyards stepping up past spike-heads and gold blocks.
  s.ground(73, 84, 64, 'candy');
  s.spikeHead(77, 61);
  s.ground(85, 94, 58, 'candy');
  s.block('goldBlock', 89, 54, 2, 4).text(89, 52, 'a');
  s.ground(95, 111, 52, 'candy');
  s.spikeHead(97, 49);
  s.text(104, 51, 'C');
  s.solid('stoneWall', 76, 22, 32, 4);
  // 4. P3 among spike-heads.
  liftOff(s, 112, 52, { crestEnd: 160, crest: 'jadeWall', floor: 'candy', wall: 'stoneWall', ledge: 'goldPlatform' });
  s.spikeHead(119, 49);
  s.text(126, 51, 'a s a');
  // 5. Straight on into P2 through the stone mountain.
  const crest = 52 - LIFT_CREST;
  s.text(146, crest - 3, 'a a');
  s.ground(161, 210, crest, 'jadeWall');
  spikeGauntlet(s, 156, crest, { wall: 'stoneWall' });
  // 6. The bull's arena, sunk 10 below the citadel floor: gold ledges around it to dodge the
  //    charges, a wasp over it, gold blocks up the far side.
  const arena = crest + 10;
  s.ground(211, 260, arena, 'candy');
  s.platform('goldPlatform', 214, arena - 5, 6).text(215, arena - 6, 's s');
  s.platform('goldPlatform', 226, arena - 9, 8).text(228, arena - 10, 'p p');
  s.platform('goldPlatform', 242, arena - 5, 6).text(243, arena - 6, 's s');
  s.foe('bull', 235, arena - 1, { range: 10 });
  s.wasp(234, arena - 16, { range: 4 });
  s.block('goldBlock', 252, arena - 4, 2, 4);
  s.block('goldBlock', 256, arena - 8, 2, 4);
  s.ground(261, 270, crest, 'jadeWall');
  s.text(264, crest - 1, 'C');
  // 7. P1 to the summit, a spike-head between the pit button and the trampoline.
  const pitX = 271;
  tandemTrampoline(s, pitX, crest + 6, { shelfEnd: 327, shelf: 'jadeWall', floor: 'candy' });
  s.spikeHead(pitX + 15, crest + 3);
  s.text(pitX + 3, crest + 5, 'a a');
  const summit = crest + 6 - TANDEM_SHELF;
  s.foe('chicken', pitX + 40, summit - 1, { range: 4 });
  s.block('goldBlock', pitX + 46, summit - 4, 2, 4).text(pitX + 46, summit - 6, 'w');
  s.solid('stoneWall', 300, 2, 28, 8);
  s.text(pitX + 52, summit - 1, 'E');
  return s;
}

/**
 * Rhino Coliseum (the boss): a last P1 in the antechamber, steps down to the arena door, and a
 * closed stone hall with a brick floor where the rhino waits. Low gold ledges to dodge its
 * charges; two trampolines up to high refuges, each powered by a button on the far ledge (a
 * teammate holds it while you escape). The trophy at the far end opens once it is beaten.
 */
export function coop4(): Sketch {
  const s = new Sketch(170, 56);
  frame(s);
  // 1. Antechamber and the P1 recap.
  s.ground(2, 29, 26, 'brick');
  s.text(5, 25, '1 2 3 4');
  arc(s, 4, 25, 'a', [3, 4, 4, 3]);
  tandemTrampoline(s, 30, 32, { shelfEnd: 69, shelf: 'stoneWall', floor: 'brick' });
  s.text(34, 31, 'a s a');
  // A vaulted stone ceiling over the antechamber, columns hanging from it (clear of the bounce).
  s.solid('stoneWall', 2, 2, 84, 8);
  for (const x of [12, 22, 40]) s.solid('stoneWall', x, 10, 2, 8);
  // 2. Steps down to the arena door; the checkpoint by the door.
  s.ground(70, 75, 28, 'stoneWall');
  s.ground(76, 79, 38, 'stoneWall');
  s.ground(80, 89, 47, 'brick');
  s.text(81, 46, 'C');
  s.text(84, 46, 'p p');
  // 3. The arena: stone walls and ceiling (rocks fall from it), brick floor. The door is a step
  //    above the floor, so the rhino can't charge out.
  s.solid('stoneWall', 86, 2, 82, 30);
  s.solid('stoneWall', 86, 32, 4, 10);
  s.solid('stoneWall', 164, 32, 4, 18);
  s.ground(90, 167, 50, 'brick');
  s.platform('goldPlatform', 94, 45, 6).text(95, 44, 's');
  s.platform('goldPlatform', 122, 45, 8).text(124, 44, 'a a');
  s.platform('goldPlatform', 152, 45, 6).text(153, 44, 's');
  // Refuges 15 up (out of jump reach), each reached by a trampoline powered from the far ledge.
  s.platform('goldPlatform', 92, 35, 6).text(93, 34, 'w');
  s.platform('goldPlatform', 156, 35, 6).text(157, 34, 'w');
  const left = s.nextName('trampoline');
  s.trampoline(104, 49);
  const right = s.nextName('trampoline');
  s.trampoline(148, 49);
  s.button(154, 44, left);
  s.button(96, 44, right);
  s.foe('rhino', 128, 49, { facing: 'left' });
  s.text(160, 49, 'E');
  return s;
}
