import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertValidGameConfig,
  ConfigValidationError,
  validateGameConfig,
} from '../assets/scripts/config/ConfigValidation.ts';
import { INITIAL_GAME_CONFIG } from '../assets/scripts/config/GameConfig.ts';

function mutableConfig() {
  return structuredClone(INITIAL_GAME_CONFIG);
}

function hasIssue(issues, text) {
  assert.ok(
    issues.some((issue) => issue.includes(text)),
    `Expected an issue containing "${text}", got:\n${issues.join('\n')}`,
  );
}

test('player maxHp is validated as a positive integer', () => {
  const config = mutableConfig();
  config.player.maxHp = 0;

  const issues = validateGameConfig(config);

  hasIssue(issues, 'player.maxHp');
});

test('resource entries require display name and positive integer capacity', () => {
  const config = mutableConfig();
  config.resources[0].displayName = '   ';
  config.resources[0].capacity = 0;
  config.resources.push({ ...config.resources[1] });

  const issues = validateGameConfig(config);

  hasIssue(issues, 'resources[res_lingshi].displayName');
  hasIssue(issues, 'resources[res_lingshi].capacity');
  hasIssue(issues, 'resources contains duplicate id "res_xiuwei"');
});

test('weapon projectile budget and spread fields are validated', () => {
  const config = mutableConfig();
  config.weapons[0].maxActiveProjectiles = 0;
  config.weapons[0].projectileSpreadDegrees = -5;

  const issues = validateGameConfig(config);

  hasIssue(issues, 'maxActiveProjectiles');
  hasIssue(issues, 'projectileSpreadDegrees');
});

test('initial game configuration is valid and deeply frozen', () => {
  assert.deepEqual(validateGameConfig(INITIAL_GAME_CONFIG), []);
  assert.doesNotThrow(() => assertValidGameConfig(INITIAL_GAME_CONFIG));
  assert.equal(Object.isFrozen(INITIAL_GAME_CONFIG), true);
  assert.equal(Object.isFrozen(INITIAL_GAME_CONFIG.monsters), true);
  assert.equal(Object.isFrozen(INITIAL_GAME_CONFIG.monsters[0]), true);
});

test('duplicate ids are rejected with the table name and id', () => {
  const config = mutableConfig();
  config.monsters.push({ ...config.monsters[0] });

  const issues = validateGameConfig(config);

  hasIssue(issues, 'monsters contains duplicate id "monster_basic"');
});

test('invalid and non-finite numeric values are rejected', () => {
  const config = mutableConfig();
  config.player.moveSpeed = 0;
  config.monsters[0].maxHp = 0;
  config.projectiles[0].speed = Number.NaN;
  config.weapons[0].projectileCount = 1.5;

  const issues = validateGameConfig(config);

  hasIssue(issues, 'player.moveSpeed');
  hasIssue(issues, 'maxHp');
  hasIssue(issues, 'speed');
  hasIssue(issues, 'projectileCount');
});

test('initial stage reference and play-area bounds are validated', () => {
  const config = mutableConfig();
  config.initialStageId = 'stage_missing';
  config.stages[0].playArea.minX = config.stages[0].playArea.maxX;

  const issues = validateGameConfig(config);

  hasIssue(issues, 'stage_missing');
  hasIssue(issues, 'playArea.minX must be less than maxX');
});

test('broken projectile, monster, and wave references are rejected', () => {
  const config = mutableConfig();
  config.weapons[0].projectileId = 'projectile_missing';
  config.spawnWaves[0].monsters[0].monsterId = 'monster_missing';
  config.stages[0].waveIds[0] = 'wave_missing';

  const issues = validateGameConfig(config);

  hasIssue(issues, 'projectile_missing');
  hasIssue(issues, 'monster_missing');
  hasIssue(issues, 'wave_missing');
});

test('level curve must be continuous and use positive integer thresholds', () => {
  const config = mutableConfig();
  config.levelCurve[1].level = 4;
  config.levelCurve[1].requiredXp = -1;

  const issues = validateGameConfig(config);

  hasIssue(issues, 'levelCurve[1].level must be 2');
  hasIssue(issues, 'levelCurve[1].requiredXp');
});

test('account player level curve shares the level curve validation rules', () => {
  const config = mutableConfig();
  config.playerLevel.levelCurve[0].level = 2;
  config.playerLevel.levelCurve[1].requiredXp = 0;
  config.playerLevel.levelCurve.splice(2, 1);

  const issues = validateGameConfig(config);

  hasIssue(issues, 'playerLevel.levelCurve[0].level must be 1');
  hasIssue(issues, 'playerLevel.levelCurve[1].requiredXp');
  hasIssue(issues, 'playerLevel.levelCurve[2].level must be 3');
});

test('realm entries validate sub-realm costs, hp bonus and breakthrough conditions', () => {
  const config = mutableConfig();
  config.realms[0].displayName = ' ';
  config.realms[0].subRealmCosts = [30, 0];
  config.realms[0].maxHpBonus = -1;
  config.realms[0].breakthrough.materialId = 'res_missing';
  config.realms[0].breakthrough.requiredPlayerLevel = -2;
  config.realms[2].breakthrough = { xiuweiCost: 1, materialId: 'res_yaodan', materialCost: 1, requiredPlayerLevel: 0 };

  const issues = validateGameConfig(config);

  hasIssue(issues, 'realms[realm_lianqi].displayName');
  hasIssue(issues, 'realms[realm_lianqi].subRealmCosts[1]');
  hasIssue(issues, 'realms[realm_lianqi].maxHpBonus');
  hasIssue(issues, 'realms[realm_lianqi].breakthrough.materialId references missing id "res_missing"');
  hasIssue(issues, 'realms[realm_lianqi].breakthrough.requiredPlayerLevel');
  hasIssue(issues, 'realms[realm_jindan].breakthrough must be null for the final realm');
});

test('weapon growth entries validate references, cost curve length and reserved ids', () => {
  const config = mutableConfig();
  config.weaponGrowth[0].maxLevel = 5;
  config.weaponGrowth[0].levelUpCosts = [80, 95];
  config.weaponGrowth[0].damagePerLevel = 0;
  config.weaponGrowth[0].ultimateIds = ['ultimate_a', 'ultimate_a'];
  config.weaponGrowth.push({ ...config.weaponGrowth[0] });
  config.weaponGrowth.push({ ...config.weaponGrowth[0], weaponId: 'weapon_missing' });

  const issues = validateGameConfig(config);

  hasIssue(issues, 'weaponGrowth contains duplicate id "weapon_qingxiao_sword"');
  hasIssue(issues, 'weaponGrowth[weapon_missing].weaponId references missing id');
  hasIssue(issues, 'weaponGrowth[weapon_missing].levelUpCosts length must be maxLevel - 1 (4)');
  hasIssue(issues, 'weaponGrowth[weapon_missing].damagePerLevel');
  hasIssue(issues, 'weaponGrowth[weapon_missing].ultimateIds contains duplicate id "ultimate_a"');
});

test('beast entries validate soul reference, costs and skill structure', () => {
  const config = mutableConfig();
  config.beasts[0].soulResourceId = 'res_missing';
  config.beasts[0].unlockSoulCost = -1;
  config.beasts[0].levelUpCosts = [50, 0];
  config.beasts[0].starUpCosts = [];
  config.beasts[0].skill = { kind: 'damageNearest', intervalSeconds: 0, damage: 1.5, projectileCount: 0 };
  config.beasts[0].skillDescription = ' ';
  config.beasts[1].skill = { kind: 'explode', intervalSeconds: 1, value: 1 };

  const issues = validateGameConfig(config);

  hasIssue(issues, 'beasts[beast_qinglong].soulResourceId references missing id "res_missing"');
  hasIssue(issues, 'beasts[beast_qinglong].unlockSoulCost');
  hasIssue(issues, 'beasts[beast_qinglong].levelUpCosts[1]');
  hasIssue(issues, 'beasts[beast_qinglong].starUpCosts must not be empty');
  hasIssue(issues, 'beasts[beast_qinglong].skill.intervalSeconds');
  hasIssue(issues, 'beasts[beast_qinglong].skill.damage');
  hasIssue(issues, 'beasts[beast_qinglong].skill.projectileCount');
  hasIssue(issues, 'beasts[beast_qinglong].skillDescription');
  hasIssue(issues, 'beasts[beast_baihu].skill has unsupported effect kind: explode');
});

test('stage reward entries validate stage/resource references, amounts and ratios', () => {
  const config = mutableConfig();
  config.stageRewards[0].accountXp = -1;
  config.stageRewards[0].resources = { ...config.stageRewards[0].resources, res_ghost: 5, res_lingshi: 2.5 };
  config.stageRewards[0].defeatRatio = 1.5;
  config.stageRewards.push({ ...config.stageRewards[0] });
  config.stageRewards.push({ ...config.stageRewards[0], stageId: 'stage_missing' });

  const issues = validateGameConfig(config);

  hasIssue(issues, 'stageRewards[stage_missing].stageId references missing id "stage_missing"');
  hasIssue(issues, 'stageRewards[stage_mvp_01].accountXp');
  hasIssue(issues, 'stageRewards[stage_mvp_01].resources references missing id "res_ghost"');
  hasIssue(issues, 'stageRewards[stage_mvp_01].resources[res_lingshi]');
  hasIssue(issues, 'stageRewards[stage_mvp_01].defeatRatio must be in [0, 1]');
  hasIssue(issues, 'stageRewards contains duplicate id "stage_mvp_01"');
});

test('stage wave order and bounds are validated', () => {
  const config = mutableConfig();
  config.stages[0].waveIds.reverse();
  config.stages[0].duration = 200;

  const issues = validateGameConfig(config);

  hasIssue(issues, 'must be ordered by wave startTime');
  hasIssue(issues, 'beyond stage duration');
});

test('V08-02 initial content ships 3 chapters x 4 stages and passes validation', () => {
  assert.deepEqual(validateGameConfig(INITIAL_GAME_CONFIG), []);
  assert.equal(INITIAL_GAME_CONFIG.chapters.length, 3);
  assert.equal(INITIAL_GAME_CONFIG.stages.length, 12);
  assert.equal(INITIAL_GAME_CONFIG.monsters.length, 4);
  assert.equal(INITIAL_GAME_CONFIG.bosses.length, 3);
  assert.equal(INITIAL_GAME_CONFIG.stageRewards.length, 12);
  // 每个关卡恰好被一个章节收录，且章节链首章无前置。
  const chapterOf = new Map();
  for (const chapter of INITIAL_GAME_CONFIG.chapters) {
    for (const stageId of chapter.stageIds) {
      assert.equal(chapterOf.has(stageId), false, `stage ${stageId} listed twice`);
      chapterOf.set(stageId, chapter.id);
    }
  }
  for (const stage of INITIAL_GAME_CONFIG.stages) {
    assert.equal(chapterOf.get(stage.id), stage.chapterId);
  }
  assert.equal(INITIAL_GAME_CONFIG.chapters[0].requiredChapterId, null);
  // 每关 3 档难度、3 条星级条件，首档恒解锁、首条件恒为通关。
  for (const stage of INITIAL_GAME_CONFIG.stages) {
    assert.equal(stage.difficulties.length, 3);
    assert.equal(stage.difficulties[0].requiredStarsOnPrevious, 0);
    assert.equal(stage.starConditions.length, 3);
    assert.equal(stage.starConditions[0].kind, 'clear');
  }
});

test('monster entries require display names (codex detail source)', () => {
  const config = mutableConfig();
  config.monsters[1].displayName = ' ';

  const issues = validateGameConfig(config);

  hasIssue(issues, 'monsters[monster_yaonu].displayName');
});

test('stage boss references and milestone rewards are validated', () => {
  const config = mutableConfig();
  config.stages[0].bossId = 'boss_missing';
  config.stages[1].milestoneRewards.perStar = config.stages[1].milestoneRewards.perStar.slice(0, 2);
  config.stages[2].milestoneRewards.firstClear.accountXp = -1;
  config.stages[3].milestoneRewards.firstClear.resources = { res_ghost: 5 };

  const issues = validateGameConfig(config);

  hasIssue(issues, 'stages[stage_mvp_01].bossId references missing id "boss_missing"');
  hasIssue(issues, 'stages[stage_qingyun_02].milestoneRewards.perStar length must be 3');
  hasIssue(issues, 'stages[stage_qingyun_03].milestoneRewards.firstClear.accountXp');
  hasIssue(issues, 'stages[stage_qingyun_04].milestoneRewards.firstClear.resources references missing id "res_ghost"');
});

test('star condition sets must have three ordered, well-typed conditions', () => {
  const config = mutableConfig();
  config.stages[0].starConditions = [{ kind: 'clear' }, { kind: 'hpRatioAbove', ratio: 0.5 }];
  config.stages[1].starConditions = [
    { kind: 'hpRatioAbove', ratio: 0.6 },
    { kind: 'clear' },
    { kind: 'hitTakenAtMost', count: 10 },
  ];
  config.stages[2].starConditions = [
    { kind: 'clear' },
    { kind: 'hpRatioAbove', ratio: 0 },
    { kind: 'hitTakenAtMost', count: -1 },
  ];
  config.stages[3].starConditions = [
    { kind: 'clear' },
    { kind: 'timeUnder', seconds: 0 },
    { kind: 'mystery', count: 1 },
  ];

  const issues = validateGameConfig(config);

  hasIssue(issues, 'stages[stage_mvp_01].starConditions length must be 3');
  hasIssue(issues, 'stages[stage_qingyun_02].starConditions[0] must be kind "clear"');
  hasIssue(issues, 'stages[stage_qingyun_02].starConditions[1] kind "clear" is only allowed as the first');
  hasIssue(issues, 'stages[stage_qingyun_03].starConditions[1].ratio must be in (0, 1]');
  hasIssue(issues, 'stages[stage_qingyun_03].starConditions[2].count');
  hasIssue(issues, 'stages[stage_qingyun_04].starConditions[1].seconds');
  hasIssue(issues, 'stages[stage_qingyun_04].starConditions[2] has unsupported condition kind: mystery');
});

test('stage difficulty tiers validate multipliers, unique ids and unlock chain', () => {
  const config = mutableConfig();
  config.stages[0].difficulties[0].hpMultiplier = 0;
  config.stages[0].difficulties[1].rewardMultiplier = -1;
  config.stages[1].difficulties[0].requiredStarsOnPrevious = 1;
  config.stages[1].difficulties[2].requiredStarsOnPrevious = 0;
  config.stages[2].difficulties.push({ ...config.stages[2].difficulties[1] });
  config.stages[3].difficulties[1].displayName = ' ';

  const issues = validateGameConfig(config);

  hasIssue(issues, 'stages[stage_mvp_01].difficulties[diff_normal].hpMultiplier');
  hasIssue(issues, 'stages[stage_mvp_01].difficulties[diff_hard].rewardMultiplier');
  hasIssue(issues, 'stages[stage_qingyun_02].difficulties[diff_normal].requiredStarsOnPrevious must be 0');
  hasIssue(issues, 'stages[stage_qingyun_02].difficulties[diff_nightmare].requiredStarsOnPrevious');
  hasIssue(issues, 'stages[stage_qingyun_03].difficulties contains duplicate id "diff_hard"');
  hasIssue(issues, 'stages[stage_qingyun_04].difficulties[diff_hard].displayName');
});

test('chapter entries validate stage lists, bidirectional ownership and unlock cycles', () => {
  const config = mutableConfig();
  config.chapters[0].displayName = ' ';
  config.chapters[0].stageIds = [...config.chapters[0].stageIds, 'stage_missing'];
  config.chapters[1].stageIds = [...config.chapters[1].stageIds, config.chapters[1].stageIds[0]];
  config.chapters[2].stageIds = config.chapters[2].stageIds.slice(0, 3);
  config.stages[11].chapterId = 'chapter_yaochao';
  // 解锁环：首章要求末章、末章要求首章。
  config.chapters[0].requiredChapterId = 'chapter_shiyao';

  const issues = validateGameConfig(config);

  hasIssue(issues, 'chapters[chapter_qingyun].displayName');
  hasIssue(issues, 'chapters[chapter_qingyun].stageIds references missing id "stage_missing"');
  hasIssue(issues, 'chapters[chapter_yaochao].stageIds contains duplicate id');
  hasIssue(issues, 'stages[stage_shiyao_04].chapterId "chapter_yaochao" does not list this stage');
  hasIssue(issues, 'chapters[chapter_qingyun] requiredChapterId chain contains a cycle');
});

test('invalid configuration fails fast with all collected issues', () => {
  const config = mutableConfig();
  config.upgrades[0].title = '   ';
  config.upgrades[0].effects[0].value = 0;

  assert.throws(
    () => assertValidGameConfig(config),
    (error) => {
      assert.ok(error instanceof ConfigValidationError);
      hasIssue(error.issues, '.title');
      hasIssue(error.issues, '.value');
      return true;
    },
  );
});

test('task entries validate period, condition, reward and prerequisite chains (V08-08)', () => {
  const config = mutableConfig();
  config.tasks[0].displayName = ' ';
  config.tasks[0].period = 'hourly';
  config.tasks[1].condition.target = 0;
  config.tasks[7].condition = { kind: 'spendResource', resourceId: 'res_ghost', target: 5 };
  config.tasks[8].reward.resources = { res_ghost: 1 };
  // 前置环：weekly_spend(12) → weekly_clear(11) → weekly_spend。
  config.tasks[12].prerequisiteTaskId = 'task_weekly_clear';
  config.tasks[11].prerequisiteTaskId = 'task_weekly_spend';
  config.tasks.push({ ...config.tasks[0] });

  const issues = validateGameConfig(config);

  hasIssue(issues, 'tasks[task_main_01].displayName');
  hasIssue(issues, 'tasks[task_main_01].period must be one of main/daily/weekly');
  hasIssue(issues, 'tasks[task_main_02].condition.target');
  hasIssue(issues, 'tasks[task_daily_kill].condition.resourceId references missing id "res_ghost"');
  hasIssue(issues, 'tasks[task_daily_clear].reward.resources references missing id "res_ghost"');
  hasIssue(issues, 'tasks[task_weekly_clear] prerequisite chain contains a cycle');
  hasIssue(issues, 'tasks contains duplicate id "task_main_01"');
});

test('achievement entries validate condition, ascending tiers and rewards (V08-10)', () => {
  const config = mutableConfig();
  config.achievements[0].displayName = ' ';
  config.achievements[1].condition = { kind: 'mystery' };
  config.achievements[2].tiers = [
    { target: 100, reward: { accountXp: 1, resources: {} } },
    { target: 100, reward: { accountXp: 1, resources: {} } },
  ];
  config.achievements[3].tiers[0].reward.resources = { res_ghost: 5 };
  config.achievements[4].tiers[0].target = 0;
  config.achievements[5].hidden = 'yes';

  const issues = validateGameConfig(config);

  hasIssue(issues, 'achievements[ach_slayer].displayName');
  hasIssue(issues, 'achievements[ach_victor].condition has unsupported condition kind: mystery');
  hasIssue(issues, 'achievements[ach_collector].tiers[1].target must be greater than tiers[0].target');
  hasIssue(issues, 'achievements[ach_cultivator].tiers[0].reward.resources references missing id "res_ghost"');
  hasIssue(issues, 'achievements[ach_patron].tiers[0].target');
  hasIssue(issues, 'achievements[ach_conqueror].hidden must be a boolean');
});

test('login reward tiers must run day 1..totalDays with valid rewards (V08-14)', () => {
  const config = mutableConfig();
  config.loginRewards.tiers[0].day = 2;
  config.loginRewards.tiers[2].reward.resources = { res_ghost: 3 };
  config.loginRewards.tiers.splice(0, 2);

  const issues = validateGameConfig(config);

  hasIssue(issues, 'loginRewards.tiers[0].day must be 1');
  hasIssue(issues, 'loginRewards.tiers[0].reward.resources references missing id "res_ghost"');
  hasIssue(issues, 'loginRewards.tiers length must equal totalDays (30)');
});

test('unlock table requires unique ids, valid condition refs and non-blank locked text (V10-02)', () => {
  const config = mutableConfig();
  config.unlocks[0].id = 'unlock_bad id';
  config.unlocks[1].featureId = 'duplicate_feature';
  config.unlocks[2].featureId = 'duplicate_feature';
  config.unlocks[3].condition = { kind: 'stageClear', stageId: 'stage_ghost' };
  config.unlocks[4].condition = { kind: 'chapterClear', chapterId: 'chapter_ghost' };
  config.unlocks[5].condition = { kind: 'mystery' };
  config.unlocks[6].lockedBehavior = 'show_condition';
  config.unlocks[6].lockedText = '   ';
  config.unlocks[7].condition = { kind: 'playerLevel', level: 0 };
  config.unlocks[8].featureFlag = 'Bad Flag';

  const issues = validateGameConfig(config);

  hasIssue(issues, 'unlocks[unlock_bad id].id must be a snake_case config id');
  hasIssue(issues, 'unlocks contains duplicate featureId "duplicate_feature"');
  hasIssue(issues, 'unlocks[unlock_realm].condition.stageId references missing id "stage_ghost"');
  hasIssue(issues, 'unlocks[unlock_beast].condition.chapterId references missing id "chapter_ghost"');
  hasIssue(issues, 'unlocks[unlock_codex].condition has unsupported kind: mystery');
  hasIssue(issues, 'unlocks[unlock_shop].lockedText must not be blank');
  hasIssue(issues, 'unlocks[unlock_offers].condition.level must be a positive integer');
  hasIssue(issues, 'unlocks[unlock_activities].featureFlag must be a snake_case config id');
});

test('initial unlock table itself passes validation', () => {
  const issues = validateGameConfig(INITIAL_GAME_CONFIG);
  assert.deepEqual(issues, []);
});

test('guide script validates linear chain, strong whitelist and skippable semantics (V10-03)', () => {
  const config = mutableConfig();
  config.guide.version = 0;
  config.guide.steps[1].nextStepId = 'guide_ghost';
  config.guide.steps[2].type = 'strong';
  config.guide.steps[3].anchorId = '  ';
  config.guide.steps.push({
    id: 'guide_orphan',
    displayName: '孤儿步骤',
    description: '不在链上',
    type: 'info',
    trigger: 'guide_home_entered',
    completionEvent: 'guide_cultivate_opened',
    nextStepId: null,
    skippable: true,
    anchorId: 'nowhere',
  });

  const issues = validateGameConfig(config);

  hasIssue(issues, 'guide.version must be a positive integer');
  hasIssue(issues, 'guide.steps[guide_attack].nextStepId references missing id "guide_ghost"');
  hasIssue(issues, 'guide.steps[guide_pickup].type "strong" is reserved for first-core-operation steps');
  hasIssue(issues, 'guide.steps[guide_pickup].skippable steps must not be "strong"');
  hasIssue(issues, 'guide.steps[guide_levelup].anchorId must not be blank');
  hasIssue(issues, 'unreachable: guide_pickup, guide_levelup, guide_settlement, guide_cultivate, guide_orphan');
});

test('initial guide script passes validation and forms the six-step shortest loop', () => {
  assert.deepEqual(validateGameConfig(INITIAL_GAME_CONFIG), []);
  assert.equal(INITIAL_GAME_CONFIG.guide.steps.length, 6);
  assert.equal(INITIAL_GAME_CONFIG.guide.entryStepId, 'guide_move');
});
