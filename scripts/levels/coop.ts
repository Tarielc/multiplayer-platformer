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
 * Meadow Gate (gentle): grass, wood platforms and bronze blocks. Boxes to break, a box holding a
 * button that powers a trampoline to a fruit shelf (break it and the trampoline stops), P1 in
 * its plainest form, rolling hills with spikes and mushrooms, P2, and a fruit perch only a
 * stacked teammate reaches.
 */
export function coop1(): Sketch {
  const s = new Sketch(300, 50);
  frame(s);
  // 1. Start meadow: boxes to break and a chicken.
  s.ground(2, 79, 40);
  s.text(5, 39, '1 2 3 4');
  arc(s, 4, 39, 'a', [3, 4, 4, 3]);
  s.box(16, 39, 1).box(19, 39, 2).text(19, 35, 's');
  s.foe('chicken', 26, 39, { range: 3 });
  s.block('bronzeBlock', 30, 38, 2, 2).text(30, 36, 'a');
  s.platform('woodPlatform', 34, 34, 6).text(35, 33, 's s s');
  // 2. The button lesson: a box rests on a button that powers a trampoline up to a fruit shelf.
  //    Break the box and the trampoline stops: a button only works while something holds it.
  const lesson = s.nextName('trampoline');
  s.trampoline(58, 39);
  s.box(50, 39, 3);
  s.button(50, 39, lesson);
  s.platform('woodPlatform', 56, 24, 8).text(57, 23, 'w  p  w');
  s.block('bronzeBlock', 66, 38, 2, 2);
  // 3. Checkpoint, then P1 down in a meadow pit: the shelf is the only way on.
  s.text(74, 39, 'C');
  tandemTrampoline(s, 80, 46, { shelfEnd: 297 });
  s.text(84, 45, 'a a a a');
  s.foe('mushroom', 96, 45, { range: 3 });
  // 4. Rolling hills on the shelf (row 30): spikes, mushrooms, fruit on wood platforms.
  const hill = 46 - TANDEM_SHELF;
  arc(s, 114, hill - 1, 'a', [2, 3, 3, 2]);
  s.foe('mushroom', 120, hill - 1, { range: 4 });
  s.spikes(127, hill - 1, 3);
  s.ground(133, 146, hill - 4).text(136, hill - 6, 's s s');
  s.spikes(151, hill - 1, 4);
  s.platform('woodPlatform', 150, hill - 6, 6).text(151, hill - 7, 'p p');
  s.foe('mushroom', 160, hill - 1, { range: 3 });
  s.carve(166, hill, 10, 4).text(168, hill + 3, 'a a a');
  s.foe('mushroom', 170, hill + 3, { range: 2 });
  s.block('bronzeBlock', 180, hill - 2, 2, 2).text(180, hill - 4, 's');
  s.foe('chicken', 187, hill - 1, { range: 3 });
  // 5. Checkpoint, then P2 through the brick gate.
  s.text(195, hill - 1, 'C');
  spikeGauntlet(s, 205, hill, { wall: 'brick' });
  // 6. The run home, past a fruit perch 13 up: a lone jump falls short, a stacked teammate makes it.
  const out = 205 + GAUNTLET_LENGTH;
  s.text(out + 6, hill - 3, 'a a');
  s.platform('woodPlatform', out + 14, hill - 13, 4).text(out + 14, hill - 14, 'w g');
  s.foe('mushroom', out + 24, hill - 1, { range: 3 });
  s.text(out + 37, hill - 1, 'E');
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
  liftOff(s, 130, 52, { crestEnd: 214, crest: 'autumn', wall: 'woodWall', ledge: 'metalPlatform' });
  s.text(136, 51, 'a s a s a');
  s.text(147, 51, 'p');
  // 6. The monkey's cliff: a brick tower with a monkey on it, climbed on metal platforms.
  const crest = 52 - LIFT_CREST;
  s.platform('metalPlatform', 170, crest - 6, 5).text(171, crest - 7, 'a a');
  s.platform('metalPlatform', 177, crest - 11, 5).text(178, crest - 12, 's');
  s.solid('brick', 185, crest - 15, 6, 15);
  s.monkey(184, crest - 1, 'right', { range: 3 });
  s.ground(191, 214, crest - 12, 'autumn');
  s.text(205, crest - 13, 'C');
  // 7. P1 with a saw sweeping the shelf: whoever holds the shelf button has to time it.
  const pit = crest - 6;
  tandemTrampoline(s, 215, pit, { shelfEnd: 270, shelf: 'brick', floor: 'autumn' });
  const shelf = pit - TANDEM_SHELF;
  s.saw(246, shelf - 2, 256, shelf - 2, { speed: 50 });
  s.text(222, pit - 1, 'a a');
  s.foe('mushroom', 230, pit - 1, { range: 3 });
  // 8. Falling platforms over a lava pit, then a checkpoint and the long P2 at the far end.
  s.ground(271, 285, 40, 'autumn');
  s.text(271, 39, 'L'.repeat(15));
  s.fallingPlatform(273, shelf).fallingPlatform(277, shelf).fallingPlatform(281, shelf);
  s.text(277, shelf - 3, 'w');
  s.ground(286, 357, shelf, 'brick');
  s.text(288, shelf - 1, 'C');
  spikeGauntlet(s, 296, shelf, { length: 52, wall: 'woodWall' });
  s.text(353, shelf - 1, 'E');
  return s;
}

/**
 * Jade Citadel: candy ground, jade and stone walls, gold blocks and platforms. New: rock-heads,
 * spike-heads, a bull. A rock-head trench (don't get pinned), spike-head steps, P3 among
 * spike-heads, P2 through the stone gate, a bull's arena on gold platforms, and P1 to the summit
 * with a spike-head by the pit button.
 */
export function coop3(): Sketch {
  const s = new Sketch(330, 72);
  frame(s);
  // 1. Start on candy ground.
  s.ground(2, 103, 64, 'candy');
  s.text(5, 63, '1 2 3 4');
  arc(s, 4, 63, 'a', [3, 4, 4, 3]);
  // 2. A trench between jade pillars where a rock-head slams from wall to wall: cross while it
  //    waits, or ride it; don't get caught against a pillar.
  s.solid('jadeWall', 30, 58, 2, 6).solid('jadeWall', 56, 58, 2, 6);
  s.rockHead(36, 62, 'x', { waitMs: 1200 });
  s.text(44, 60, 's s s');
  // 3. Candy steps with spike-heads to jump.
  s.ground(64, 103, 58, 'candy');
  s.spikeHead(72, 55);
  s.block('goldBlock', 80, 54, 2, 4).text(80, 52, 'a');
  s.spikeHead(88, 55);
  s.text(96, 57, 'p');
  // 4. P3 among spike-heads, with a checkpoint at the tunnel.
  s.ground(104, 111, 64, 'candy');
  s.text(105, 63, 'C');
  liftOff(s, 112, 64, { crestEnd: 327, crest: 'jadeWall', floor: 'candy', wall: 'stoneWall', ledge: 'goldPlatform' });
  s.spikeHead(119, 61);
  s.text(126, 63, 'a s a');
  // 5. Straight on into P2 through the stone gate.
  const crest = 64 - LIFT_CREST;
  s.text(146, crest - 3, 'a a');
  spikeGauntlet(s, 152, crest, { wall: 'stoneWall' });
  // 6. A bull's arena: gold platforms to dodge its charges, gold blocks to hide behind.
  const arena = 152 + GAUNTLET_LENGTH + 4;
  s.platform('goldPlatform', arena + 8, crest - 5, 5).text(arena + 9, crest - 6, 's s');
  s.foe('bull', arena + 22, crest - 1, { range: 8 });
  s.platform('goldPlatform', arena + 28, crest - 6, 6).text(arena + 29, crest - 7, 'p p');
  s.block('goldBlock', arena + 38, crest - 2, 2, 2);
  s.wasp(arena + 30, crest - 14, { range: 4 });
  s.text(arena + 46, crest - 1, 'C');
  // 7. P1 to the summit, a spike-head between the pit button and the trampoline.
  const pitX = arena + 52;
  s.carve(pitX, crest, 28, 6);
  tandemTrampoline(s, pitX, crest + 6, { shelfEnd: 327, shelf: 'jadeWall', floor: 'candy' });
  s.spikeHead(pitX + 15, crest + 3);
  s.text(pitX + 3, crest + 5, 'a a');
  const summit = crest + 6 - TANDEM_SHELF;
  s.foe('chicken', pitX + 40, summit - 1, { range: 4 });
  s.block('goldBlock', pitX + 50, summit - 4, 2, 4).text(pitX + 50, summit - 6, 'w');
  s.text(pitX + 62, summit - 1, 'E');
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
