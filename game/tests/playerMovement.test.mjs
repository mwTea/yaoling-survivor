import assert from 'node:assert/strict';
import test from 'node:test';

import { MovementInputState } from '../assets/scripts/player/MovementInputState.ts';
import { moveWithinBounds } from '../assets/scripts/player/PlayerMovement.ts';
import { resolveVirtualJoystick } from '../assets/scripts/player/VirtualJoystickMath.ts';

const BOUNDS = { minX: -10, maxX: 10, minY: -5, maxY: 5 };

test('keyboard input normalizes diagonal movement and clears cleanly', () => {
  const state = new MovementInputState();
  const direction = { x: 0, y: 0 };

  state.setKeyboardDirection(1, 1);
  state.writeDirection(direction);
  assert.ok(Math.abs(Math.hypot(direction.x, direction.y) - 1) < 1e-12);
  assert.ok(direction.x > 0 && direction.y > 0);

  state.clear();
  state.writeDirection(direction);
  assert.deepEqual(direction, { x: 0, y: 0 });
});

test('invalid input axes become zero and oversized axes are clamped', () => {
  const state = new MovementInputState();
  const direction = { x: 0, y: 0 };

  state.setKeyboardDirection(Number.NaN, 4);
  state.writeDirection(direction);

  assert.deepEqual(direction, { x: 0, y: 1 });
});

test('movement uses speed and delta time without diagonal acceleration', () => {
  const next = { x: 0, y: 0 };

  moveWithinBounds({ x: 0, y: 0 }, { x: 1, y: 1 }, 10, 0.5, BOUNDS, next);

  const expectedAxisDistance = 5 / Math.sqrt(2);
  assert.ok(Math.abs(next.x - expectedAxisDistance) < 1e-12);
  assert.ok(Math.abs(next.y - expectedAxisDistance) < 1e-12);
});

test('movement is frame-rate independent for equivalent elapsed time', () => {
  const oneStep = { x: 0, y: 0 };
  const firstHalf = { x: 0, y: 0 };
  const twoSteps = { x: 0, y: 0 };

  moveWithinBounds({ x: 0, y: 0 }, { x: 1, y: 0 }, 8, 1, BOUNDS, oneStep);
  moveWithinBounds({ x: 0, y: 0 }, { x: 1, y: 0 }, 8, 0.5, BOUNDS, firstHalf);
  moveWithinBounds(firstHalf, { x: 1, y: 0 }, 8, 0.5, BOUNDS, twoSteps);

  assert.deepEqual(twoSteps, oneStep);
});

test('movement is clamped to the configured play area', () => {
  const next = { x: 0, y: 0 };

  moveWithinBounds({ x: 9, y: -4 }, { x: 1, y: -1 }, 100, 1, BOUNDS, next);

  assert.deepEqual(next, { x: 10, y: -5 });
});

test('zero battle delta produces no movement', () => {
  const next = { x: 0, y: 0 };

  moveWithinBounds({ x: 3, y: 2 }, { x: 1, y: 0 }, 100, 0, BOUNDS, next);

  assert.deepEqual(next, { x: 3, y: 2 });
});

test('active joystick overrides keyboard and release restores keyboard input', () => {
  const state = new MovementInputState();
  const direction = { x: 0, y: 0 };
  state.setKeyboardDirection(1, 0);
  state.setJoystickDirection(0, -1);

  state.writeDirection(direction);
  assert.deepEqual(direction, { x: 0, y: -1 });

  state.clearJoystickDirection();
  state.writeDirection(direction);
  assert.deepEqual(direction, { x: 1, y: 0 });
});

test('joystick dead zone produces zero intent while retaining touch ownership', () => {
  const handle = { x: 0, y: 0 };
  const direction = { x: 1, y: 1 };

  resolveVirtualJoystick(5, 0, 100, 0.15, handle, direction);

  assert.deepEqual(handle, { x: 5, y: 0 });
  assert.deepEqual(direction, { x: 0, y: 0 });
});

test('joystick handle and direction clamp at configured radius', () => {
  const handle = { x: 0, y: 0 };
  const direction = { x: 0, y: 0 };

  resolveVirtualJoystick(300, 400, 100, 0.15, handle, direction);

  assert.deepEqual(handle, { x: 60, y: 80 });
  assert.deepEqual(direction, { x: 0.6, y: 0.8 });
});
