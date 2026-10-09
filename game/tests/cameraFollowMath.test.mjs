import assert from 'node:assert/strict';
import test from 'node:test';

import { computeWorldOffset } from '../assets/scripts/ui/CameraFollowMath.ts';

// 世界 2400×1600（±1200/±800），视口 960×640（半宽 480/半高 320）
const PLAY_AREA = { minX: -1200, maxX: 1200, minY: -800, maxY: 800 };
const VIEW_W = 960;
const VIEW_H = 640;

test('camera centers on the player when roaming the middle region', () => {
  const out = { x: 0, y: 0 };

  computeWorldOffset(0, 0, PLAY_AREA, VIEW_W, VIEW_H, out);
  assert.deepEqual(out, { x: 0, y: 0 });

  computeWorldOffset(100, -50, PLAY_AREA, VIEW_W, VIEW_H, out);
  assert.deepEqual(out, { x: -100, y: 50 });
});

test('camera clamps at world edges without showing the void', () => {
  const out = { x: 0, y: 0 };

  computeWorldOffset(1100, 0, PLAY_AREA, VIEW_W, VIEW_H, out);
  assert.deepEqual(out, { x: -(1200 - 480), y: 0 }, 'right edge: view center at maxX - halfView');

  computeWorldOffset(0, 780, PLAY_AREA, VIEW_W, VIEW_H, out);
  assert.deepEqual(out, { x: 0, y: -(800 - 320) }, 'top edge');

  computeWorldOffset(-1200, -800, PLAY_AREA, VIEW_W, VIEW_H, out);
  assert.deepEqual(out, { x: -(-1200 + 480), y: -(-800 + 320) }, 'bottom-left corner');
});

test('view larger than the world centers instead of clamping to negative range', () => {
  const smallArea = { minX: -100, maxX: 100, minY: -80, maxY: 80 };
  const out = { x: 0, y: 0 };

  computeWorldOffset(90, -70, smallArea, VIEW_W, VIEW_H, out);
  assert.deepEqual(out, { x: 0, y: 0 }, 'degenerate config centers the world');
});
