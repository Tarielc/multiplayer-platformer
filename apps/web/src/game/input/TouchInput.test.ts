import { Button, aimFromButtons, withAim } from '@platformer/shared';
import { describe, expect, it } from 'vitest';
import { TouchInput } from './TouchInput';

const MOVE = Button.LEFT | Button.RIGHT | Button.DOWN | Button.JUMP;
const has = (buttons: number, button: number) => (buttons & button) !== 0;

describe('TouchInput', () => {
  it('is neutral by default', () => {
    const touch = new TouchInput();
    expect(touch.apply(0)).toBe(0);
    expect(touch.aim(1)).toBeNull();
  });

  it('maps the walk stick to left / right / down past the thresholds', () => {
    const touch = new TouchInput();
    touch.setWalk(0.2, 0.1);
    expect(touch.apply(0) & MOVE).toBe(0);
    touch.setWalk(-0.8, 0);
    expect(touch.apply(0) & MOVE).toBe(Button.LEFT);
    touch.setWalk(0.8, 0);
    expect(touch.apply(0) & MOVE).toBe(Button.RIGHT);
    touch.setWalk(-0.5, 0.8);
    expect(touch.apply(0) & MOVE).toBe(Button.LEFT | Button.DOWN);
    touch.releaseWalk();
    expect(touch.apply(0)).toBe(0);
  });

  it('flies the drone up with the walk stick only while piloting', () => {
    const touch = new TouchInput();
    touch.setWalk(0, -0.9);
    expect(has(touch.apply(0), Button.JUMP)).toBe(false);
    expect(has(touch.apply(0, true), Button.JUMP)).toBe(true);
  });

  it('keeps the existing buttons', () => {
    const touch = new TouchInput();
    expect(touch.apply(Button.RIGHT | Button.ATTACK)).toBe(Button.RIGHT | Button.ATTACK);
  });

  it('holds jump, and latches a tap until a step consumes it', () => {
    const touch = new TouchInput();
    touch.pressJump();
    expect(has(touch.apply(0), Button.JUMP)).toBe(true);
    touch.releaseJump(); // released before the next step
    expect(has(touch.apply(0), Button.JUMP)).toBe(true);
    touch.consume();
    expect(has(touch.apply(0), Button.JUMP)).toBe(false);
  });

  it('fires the special on release, along the drag', () => {
    const touch = new TouchInput();
    touch.dragSpecial(0, -1);
    expect(has(touch.apply(0), Button.SPECIAL)).toBe(false);
    expect(touch.aim(1)).toBeCloseTo(-Math.PI / 2);
    touch.releaseSpecial(-1, 0);
    expect(has(touch.apply(0), Button.SPECIAL)).toBe(true);
    const aim = touch.aim(1);
    expect(aim).toBeCloseTo(Math.PI);
    expect(aimFromButtons(withAim(touch.apply(0), aim!), 1)).toBeCloseTo(Math.PI);
    touch.consume();
    expect(has(touch.apply(0), Button.SPECIAL)).toBe(false);
    expect(touch.aim(1)).toBeNull();
  });

  it('aims straight ahead while the special stick is held near its centre', () => {
    const touch = new TouchInput();
    touch.dragSpecial(0.1, 0.1);
    expect(touch.aim(1)).toBe(0);
    expect(touch.aim(-1)).toBe(Math.PI);
  });

  it('fires a tapped special straight ahead (no aim)', () => {
    const touch = new TouchInput();
    touch.dragSpecial(0, 0);
    touch.releaseSpecial(0.1, 0);
    expect(has(touch.apply(0), Button.SPECIAL)).toBe(true);
    expect(touch.aim(1)).toBeNull();
  });

  it('drops a cancelled special without firing', () => {
    const touch = new TouchInput();
    touch.dragSpecial(1, 0);
    touch.cancelSpecial();
    expect(has(touch.apply(0), Button.SPECIAL)).toBe(false);
    expect(touch.aim(1)).toBeNull();
  });

  it('swings on attack release, turned to the dragged side for that step', () => {
    const touch = new TouchInput();
    touch.setWalk(1, 0); // walking right
    touch.releaseAttack(-0.9);
    const step = touch.apply(Button.RIGHT);
    expect(has(step, Button.ATTACK)).toBe(true);
    expect(has(step, Button.LEFT)).toBe(true);
    expect(has(step, Button.RIGHT)).toBe(false);
    touch.consume();
    expect(touch.apply(0) & (Button.ATTACK | Button.LEFT | Button.RIGHT)).toBe(Button.RIGHT);
  });

  it('swings the way the player faces on an attack tap', () => {
    const touch = new TouchInput();
    touch.releaseAttack(0.1);
    expect(touch.apply(0)).toBe(Button.ATTACK);
    expect(touch.apply(Button.LEFT)).toBe(Button.ATTACK | Button.LEFT);
  });

  it('reset clears sticks, held buttons and latches', () => {
    const touch = new TouchInput();
    touch.setWalk(1, 1);
    touch.pressJump();
    touch.dragSpecial(1, 0);
    touch.releaseAttack(1);
    touch.reset();
    expect(touch.apply(0, true)).toBe(0);
    expect(touch.aim(1)).toBeNull();
  });
});
