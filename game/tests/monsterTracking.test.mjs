import assert from 'node:assert/strict';
import test from 'node:test';

import { moveTowards } from '../assets/scripts/monster/MonsterMovement.ts';

test('moves along the normalized direction at speed * deltaTime', () => {
  const out = { x: 0, y: 0 };

  moveTowards({ x: 0, y: 0 }, { x: 30, y: 40 }, 50, 0.5, out);
  assert.equal(out.x, 15);
  assert.equal(out.y, 20);

  moveTowards({ x: 10, y: -4 }, { x: -10, y: -4 }, 100, 0.1, out);
  assert.equal(out.x, 0);
  assert.equal(out.y, -4);
});

test('clamps at the target instead of overshooting', () => {
  const out = { x: 0, y: 0 };

  moveTowards({ x: 0, y: 0 }, { x: 3, y: 4 }, 1000, 1, out);
  assert.deepEqual(out, { x: 3, y: 4 });

  moveTowards({ x: 2, y: 2 }, { x: 3, y: 4 }, 90, 1, out);
  assert.deepEqual(out, { x: 3, y: 4 });
});

test('zero distance or zero deltaTime keeps the position stable', () => {
  const out = { x: 9, y: 9 };

  moveTowards({ x: 5, y: 5 }, { x: 5, y: 5 }, 90, 1, out);
  assert.deepEqual(out, { x: 5, y: 5 });

  out.x = 0;
  out.y = 0;
  moveTowards({ x: 0, y: 0 }, { x: 100, y: 0 }, 90, 0, out);
  assert.deepEqual(out, { x: 0, y: 0 });
});
