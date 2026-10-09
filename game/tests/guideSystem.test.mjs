import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getActiveGuideStep,
  handleGuideEvent,
  isGuideScriptDone,
  isGuideStepBlocking,
  skipActiveGuideStep,
} from '../assets/scripts/account/GuideSystem.ts';
import { INITIAL_GAME_CONFIG } from '../assets/scripts/config/GameConfig.ts';

// 真实配置当前 enabled=false（用户决策测试期关闭）；本文件以开启态副本验证状态机。
const SCRIPT = { ...INITIAL_GAME_CONFIG.guide, enabled: true };

/** 首发脚本六步的推进事件序列（触发→完成的完整最短闭环）。 */
const FIRST_LOOP_EVENTS = [
  'guide_battle_started',
  'guide_move_started',
  'guide_attack_fired',
  'guide_xp_collected',
  'guide_levelup_resolved',
  'guide_settlement_shown',
  'guide_cultivate_opened',
];

function freshGuideState() {
  return { scriptVersion: 0, completedStepIds: [] };
}

test('first loop walks the whole script: start stamp, chain completion, script completion', () => {
  const state = freshGuideState();

  // 事件先于入口触发：不启动脚本。
  const premature = handleGuideEvent(SCRIPT, state, 'guide_move_started');
  assert.equal(premature.progressed, false);
  assert.equal(premature.reason, 'not_started');
  assert.equal(state.scriptVersion, 0);

  // 入口触发启动脚本并盖章版本（不完成入口步骤）。
  const started = handleGuideEvent(SCRIPT, state, 'guide_battle_started');
  assert.deepEqual(
    { kind: started.kind, stepId: started.stepId, progressed: started.progressed, scriptCompleted: started.scriptCompleted },
    { kind: 'script_started', stepId: 'guide_move', progressed: true, scriptCompleted: false },
  );
  assert.equal(state.scriptVersion, SCRIPT.version);
  assert.deepEqual(state.completedStepIds, []);
  assert.equal(getActiveGuideStep(SCRIPT, state).id, 'guide_move');

  // 逐步推进。
  const expectedChain = ['guide_move', 'guide_attack', 'guide_pickup', 'guide_levelup', 'guide_settlement', 'guide_cultivate'];
  for (let index = 1; index < FIRST_LOOP_EVENTS.length; index += 1) {
    const result = handleGuideEvent(SCRIPT, state, FIRST_LOOP_EVENTS[index]);
    const expectedStep = expectedChain[index - 1];
    assert.equal(result.kind, 'step_completed', `event ${FIRST_LOOP_EVENTS[index]} should complete ${expectedStep}`);
    assert.equal(result.stepId, expectedStep);
    assert.equal(result.scriptCompleted, index === FIRST_LOOP_EVENTS.length - 1);
  }
  assert.deepEqual(state.completedStepIds, expectedChain);
  assert.equal(getActiveGuideStep(SCRIPT, state), null, 'script is done after the final step');

  // 脚本完结后任何事件零写入（幂等）。
  const after = handleGuideEvent(SCRIPT, state, 'guide_battle_started');
  assert.equal(after.progressed, false);
  assert.equal(after.reason, 'script_done');
  assert.equal(after.scriptCompleted, true);
});

test('duplicate and out-of-order events never double-record or derail the chain', () => {
  const state = freshGuideState();
  handleGuideEvent(SCRIPT, state, 'guide_battle_started');

  // 乱序事件（尚未到拾取步）被忽略。
  const stray = handleGuideEvent(SCRIPT, state, 'guide_xp_collected');
  assert.equal(stray.progressed, false);
  assert.equal(stray.reason, 'event_mismatch');
  assert.deepEqual(state.completedStepIds, []);

  assert.equal(handleGuideEvent(SCRIPT, state, 'guide_move_started').kind, 'step_completed');
  // 重复完成事件：此时活跃步骤已是 guide_attack，旧事件不再生效、列表不重复。
  const duplicate = handleGuideEvent(SCRIPT, state, 'guide_move_started');
  assert.equal(duplicate.progressed, false);
  assert.equal(duplicate.reason, 'event_mismatch');
  assert.deepEqual(state.completedStepIds, ['guide_move']);
});

test('script start stamping is idempotent across repeated battle entries', () => {
  const state = freshGuideState();
  const first = handleGuideEvent(SCRIPT, state, 'guide_battle_started');
  assert.equal(first.kind, 'script_started');
  const second = handleGuideEvent(SCRIPT, state, 'guide_battle_started');
  assert.equal(second.progressed, false, 'second trigger is a normal mismatch, not a restart');
  assert.equal(state.scriptVersion, SCRIPT.version);
  assert.deepEqual(state.completedStepIds, []);
});

test('skip advances only skippable steps; strong steps reject skipping', () => {
  const state = freshGuideState();
  assert.equal(skipActiveGuideStep(SCRIPT, state).ok, false, 'cannot skip before the script starts');
  handleGuideEvent(SCRIPT, state, 'guide_battle_started');

  // strong 步骤（移动）不可跳过。
  const strongSkip = skipActiveGuideStep(SCRIPT, state);
  assert.deepEqual(strongSkip, { ok: false, reason: 'not_skippable' });

  // 完成 移动 → 弱提示攻击步骤可跳过。
  handleGuideEvent(SCRIPT, state, 'guide_move_started');
  const skip = skipActiveGuideStep(SCRIPT, state);
  assert.equal(skip.ok, true);
  if (skip.ok) {
    assert.equal(skip.skippedStepId, 'guide_attack');
    assert.equal(skip.nextStepId, 'guide_pickup');
    assert.equal(skip.scriptCompleted, false);
  }
  assert.deepEqual(state.completedStepIds, ['guide_move', 'guide_attack']);
  assert.equal(getActiveGuideStep(SCRIPT, state).id, 'guide_pickup', 'skip advances the chain without the completion event');
});

test('skippable steps never block battle; strong steps do (semantic invariant)', () => {
  for (const step of SCRIPT.steps) {
    if (step.skippable) {
      assert.equal(isGuideStepBlocking(step), false, `skippable step ${step.id} must not block battle`);
    }
  }
  assert.equal(isGuideStepBlocking(SCRIPT.steps.find((step) => step.id === 'guide_move')), true);
  assert.equal(isGuideStepBlocking(SCRIPT.steps.find((step) => step.id === 'guide_levelup')), true);
  assert.equal(isGuideStepBlocking(SCRIPT.steps.find((step) => step.id === 'guide_cultivate')), true);
  assert.equal(isGuideStepBlocking(SCRIPT.steps.find((step) => step.id === 'guide_settlement')), false);
});

test('mid-script progress resumes from the first incomplete step', () => {
  const state = { scriptVersion: SCRIPT.version, completedStepIds: ['guide_move', 'guide_attack'] };
  assert.equal(getActiveGuideStep(SCRIPT, state).id, 'guide_pickup');
  const result = handleGuideEvent(SCRIPT, state, 'guide_xp_collected');
  assert.equal(result.kind, 'step_completed');
  assert.deepEqual(state.completedStepIds, ['guide_move', 'guide_attack', 'guide_pickup']);
});

test('version migration: old-version players are never re-guided by a new script version', () => {
  // v1 已完结的老玩家遇到 v2 脚本：视为完结，事件零写入，不重卡。
  const oldDone = { scriptVersion: 1, completedStepIds: ['guide_move', 'guide_attack', 'guide_pickup', 'guide_levelup', 'guide_settlement', 'guide_cultivate'] };
  const scriptV2 = { ...SCRIPT, version: 2 };
  assert.equal(isGuideScriptDone(scriptV2, oldDone), true);
  const ignored = handleGuideEvent(scriptV2, oldDone, 'guide_battle_started');
  assert.equal(ignored.progressed, false);
  assert.equal(ignored.reason, 'script_done');
  assert.equal(oldDone.scriptVersion, 1, 'migration never rewrites the save');

  // v1 中途退出的玩家同样不重卡（改版后不再继续旧进度）。
  const oldPartial = { scriptVersion: 1, completedStepIds: ['guide_move'] };
  assert.equal(isGuideScriptDone(scriptV2, oldPartial), true);

  // v2 玩家正常续走。
  const current = { scriptVersion: 2, completedStepIds: ['guide_move', 'guide_attack'] };
  assert.equal(isGuideScriptDone(scriptV2, current), false);
  assert.equal(getActiveGuideStep(scriptV2, current).id, 'guide_pickup');

  // 存档版本比配置更新（回滚包）：同样不推进。
  const newer = { scriptVersion: 3, completedStepIds: [] };
  assert.equal(isGuideScriptDone(scriptV2, newer), true);
});

test('fresh saves start the current script version from zero', () => {
  const state = freshGuideState();
  assert.equal(isGuideScriptDone(SCRIPT, state), false);
  assert.equal(getActiveGuideStep(SCRIPT, state), null, 'not-yet-started script has no active step');
  const started = handleGuideEvent(SCRIPT, state, 'guide_battle_started');
  assert.equal(started.kind, 'script_started');
  assert.equal(state.scriptVersion, 1);
});

test('guide master switch off: never starts, never shows, zero writes', () => {
  const disabled = { ...INITIAL_GAME_CONFIG.guide, enabled: false };
  const state = { scriptVersion: 0, completedStepIds: [] };

  assert.equal(isGuideScriptDone(disabled, state), true, 'disabled script is terminal for everyone');
  assert.equal(getActiveGuideStep(disabled, state), null, 'no overlay content while disabled');
  const result = handleGuideEvent(disabled, state, 'guide_battle_started');
  assert.equal(result.progressed, false);
  assert.equal(result.reason, 'script_done');
  assert.equal(state.scriptVersion, 0, 'trigger never stamps the version while disabled');
  assert.deepEqual(state.completedStepIds, [], 'no audit writes while disabled');
  assert.equal(skipActiveGuideStep(disabled, state).ok, false);
});

test('guide switch off is ignored by already-started saves too (no retroactive reset)', () => {
  const disabled = { ...INITIAL_GAME_CONFIG.guide, enabled: false };
  const midScript = { scriptVersion: 1, completedStepIds: ['guide_move'] };
  assert.equal(isGuideScriptDone(disabled, midScript), true);
  assert.equal(getActiveGuideStep(disabled, midScript), null);
  assert.deepEqual(midScript.completedStepIds, ['guide_move'], 'existing audit data untouched');
});
