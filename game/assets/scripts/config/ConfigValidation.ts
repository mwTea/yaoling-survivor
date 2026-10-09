import type {
  AchievementConfig,
  ActivityConfig,
  BeastConfig,
  ChapterConfig,
  LoginRewardConfig,
  OfferConfig,
  ShopGroupConfig,
  ShopItemConfig,
  ConfigId,
  GameConfig,
  GongfaEffect,
  LevelCurveEntry,
  RealmConfig,
  SpawnWaveConfig,
  StageDifficultyConfig,
  StageMilestoneGrant,
  StageRewardConfig,
  StarCondition,
  TaskConfig,
  UnlockConfig,
  UpgradeEffect,
  WeaponGrowthConfig,
  GuideScriptConfig,
  AudioConfig,
  AdConfig,
} from './ConfigTypes';

const CONFIG_ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export class ConfigValidationError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(`Invalid game configuration:\n- ${issues.join('\n- ')}`);
    this.name = 'ConfigValidationError';
    this.issues = [...issues];
  }
}

export function validateGameConfig(config: GameConfig): readonly string[] {
  const issues: string[] = [];
  const monsterIds = collectIds(config.monsters, 'monsters', issues);
  const projectileIds = collectIds(config.projectiles, 'projectiles', issues);
  const weaponIds = collectIds(config.weapons, 'weapons', issues);
  collectIds(config.pickups, 'pickups', issues);
  const waveIds = collectIds(config.spawnWaves, 'spawnWaves', issues);
  const stageIds = collectIds(config.stages, 'stages', issues);
  const chapterIds = collectIds(config.chapters, 'chapters', issues);
  collectIds(config.upgrades, 'upgrades', issues);
  collectIds(config.gongfas, 'gongfas', issues);
  collectIds(config.treasures, 'treasures', issues);
  const bossIds = collectIds(config.bosses, 'bosses', issues);
  collectIds(config.beasts, 'beasts', issues);
  const resourceIds = collectIds(config.resources, 'resources', issues);
  collectIds(config.realms, 'realms', issues);
  for (const boss of config.bosses) {
    const path = `bosses[${boss.id}]`;
    requireNonBlank(boss.displayName, `${path}.displayName`, issues);
    requireNonNegative(boss.spawnTime, `${path}.spawnTime`, issues);
    requirePositiveInteger(boss.maxHp, `${path}.maxHp`, issues);
    requirePositive(boss.moveSpeed, `${path}.moveSpeed`, issues);
    requireNonNegativeInteger(boss.contactDamage, `${path}.contactDamage`, issues);
    requirePositiveInteger(boss.xpValue, `${path}.xpValue`, issues);
    requirePositive(boss.collisionRadius, `${path}.collisionRadius`, issues);
    requirePositiveInteger(boss.radialBurst.count, `${path}.radialBurst.count`, issues);
    requireNonNegativeInteger(boss.radialBurst.damage, `${path}.radialBurst.damage`, issues);
    requirePositive(boss.radialBurst.burstIntervalSeconds, `${path}.radialBurst.burstIntervalSeconds`, issues);
    requirePositive(boss.radialBurst.enragedIntervalSeconds, `${path}.radialBurst.enragedIntervalSeconds`, issues);
  }
  requirePositive(config.eliteModifier.hpMultiplier, 'eliteModifier.hpMultiplier', issues);
  requirePositive(config.eliteModifier.speedMultiplier, 'eliteModifier.speedMultiplier', issues);
  requirePositive(config.eliteModifier.contactDamageMultiplier, 'eliteModifier.contactDamageMultiplier', issues);
  requirePositive(config.eliteModifier.xpMultiplier, 'eliteModifier.xpMultiplier', issues);
  requirePositive(config.eliteModifier.collisionRadiusMultiplier, 'eliteModifier.collisionRadiusMultiplier', issues);

  requireReference(config.initialStageId, stageIds, 'initialStageId', issues);
  requirePositive(config.player.moveSpeed, 'player.moveSpeed', issues);
  requirePositive(config.player.collisionRadius, 'player.collisionRadius', issues);
  requirePositiveInteger(config.player.maxHp, 'player.maxHp', issues);
  requireNonNegative(config.player.invulnerableSeconds, 'player.invulnerableSeconds', issues);

  for (const monster of config.monsters) {
    const path = `monsters[${monster.id}]`;
    requireNonBlank(monster.displayName, `${path}.displayName`, issues);
    requireConfigId(monster.prefabId, `${path}.prefabId`, issues);
    requirePositiveInteger(monster.maxHp, `${path}.maxHp`, issues);
    requireNonNegative(monster.moveSpeed, `${path}.moveSpeed`, issues);
    requireNonNegativeInteger(monster.contactDamage, `${path}.contactDamage`, issues);
    requireNonNegativeInteger(monster.xpValue, `${path}.xpValue`, issues);
    requirePositive(monster.collisionRadius, `${path}.collisionRadius`, issues);
  }

  for (const projectile of config.projectiles) {
    const path = `projectiles[${projectile.id}]`;
    requireConfigId(projectile.prefabId, `${path}.prefabId`, issues);
    requirePositive(projectile.speed, `${path}.speed`, issues);
    requirePositive(projectile.lifetime, `${path}.lifetime`, issues);
    requirePositive(projectile.collisionRadius, `${path}.collisionRadius`, issues);
  }

  for (const pickup of config.pickups) {
    const path = `pickups[${pickup.id}]`;
    requireConfigId(pickup.prefabId, `${path}.prefabId`, issues);
    requirePositive(pickup.pickupRadius, `${path}.pickupRadius`, issues);
    requirePositiveInteger(pickup.maxActiveCount, `${path}.maxActiveCount`, issues);
  }

  for (const resource of config.resources) {
    const path = `resources[${resource.id}]`;
    requireNonBlank(resource.displayName, `${path}.displayName`, issues);
    requirePositiveInteger(resource.capacity, `${path}.capacity`, issues);
  }

  for (let index = 0; index < config.realms.length; index += 1) {
    const realm = config.realms[index];
    if (realm !== undefined) {
      validateRealm(realm, index === config.realms.length - 1, resourceIds, issues);
    }
  }

  // weaponGrowth 以 weaponId 引用法器（引用字段以 Id 结尾），唯一性在循环内检查。
  const growthWeaponIds = new Set<ConfigId>();
  for (const growth of config.weaponGrowth) {
    requireConfigId(growth.weaponId, 'weaponGrowth.weaponId', issues);
    if (growthWeaponIds.has(growth.weaponId)) {
      issues.push(`weaponGrowth contains duplicate id "${growth.weaponId}"`);
    }
    growthWeaponIds.add(growth.weaponId);
    validateWeaponGrowth(growth, weaponIds, issues);
  }

  for (const beast of config.beasts) {
    validateBeast(beast, resourceIds, issues);
  }

  const stageRewardStageIds = new Set<ConfigId>();
  for (const reward of config.stageRewards) {
    requireConfigId(reward.stageId, 'stageRewards.stageId', issues);
    if (stageRewardStageIds.has(reward.stageId)) {
      issues.push(`stageRewards contains duplicate id "${reward.stageId}"`);
    }
    stageRewardStageIds.add(reward.stageId);
    validateStageReward(reward, stageIds, resourceIds, issues);
  }

  const taskIds = collectIds(config.tasks, 'tasks', issues);
  for (const task of config.tasks) {
    validateTask(task, config.tasks, taskIds, resourceIds, issues);
  }

  collectIds(config.achievements, 'achievements', issues);
  for (const achievement of config.achievements) {
    validateAchievement(achievement, resourceIds, issues);
  }

  validateLoginRewards(config.loginRewards, resourceIds, issues);

  for (const activity of config.activities) {
    validateActivity(activity, issues);
  }

  const offerIds = collectIds(config.offers, 'offers', issues);
  for (const offer of config.offers) {
    validateOffer(offer, config.offers, offerIds, config.chapters, resourceIds, issues);
  }

  const shopItemIds = collectIds(config.shopItems, 'shopItems', issues);
  for (const item of config.shopItems) {
    validateShopItem(item, resourceIds, issues);
  }
  for (const group of config.shopGroups) {
    validateShopGroup(group, shopItemIds, issues);
  }

  validateUnlocks(config.unlocks, config.stages, config.chapters, issues);

  validateGuideScript(config.guide, issues);

  validateAudio(config.audio, issues);

  validateAds(config.ads, config.stages, resourceIds, issues);

  for (const gongfa of config.gongfas) {
    const path = `gongfas[${gongfa.id}]`;
    requireNonBlank(gongfa.title, `${path}.title`, issues);
    requireNonBlank(gongfa.description, `${path}.description`, issues);
    requirePositiveInteger(gongfa.maxStacks, `${path}.maxStacks`, issues);
    requirePositive(gongfa.weight, `${path}.weight`, issues);
    requireNonEmptyArray(gongfa.effects, `${path}.effects`, issues);
    for (let index = 0; index < gongfa.effects.length; index += 1) {
      validateGongfaEffect(gongfa.effects[index], `${path}.effects[${index}]`, issues);
    }
  }

  for (const treasure of config.treasures) {
    const path = `treasures[${treasure.id}]`;
    requireNonBlank(treasure.title, `${path}.title`, issues);
    requireNonBlank(treasure.description, `${path}.description`, issues);
    requirePositiveInteger(treasure.maxStacks, `${path}.maxStacks`, issues);
    requirePositive(treasure.weight, `${path}.weight`, issues);
    requireNonEmptyArray(treasure.effects, `${path}.effects`, issues);
    for (let index = 0; index < treasure.effects.length; index += 1) {
      const effect = treasure.effects[index];
      const effectPath = `${path}.effects[${index}]`;
      if (effect === undefined) {
        issues.push(`${effectPath} is missing`);
      } else if (effect.kind === 'healOnKill') {
        requirePositiveInteger(effect.value, `${effectPath}.value`, issues);
      } else {
        issues.push(`${effectPath} has unsupported effect kind: ${String(effect.kind)}`);
      }
    }
  }

  for (const weapon of config.weapons) {
    const path = `weapons[${weapon.id}]`;
    requireReference(weapon.projectileId, projectileIds, `${path}.projectileId`, issues);
    requireNonBlank(weapon.displayName, `${path}.displayName`, issues);
    requireNonNegativeInteger(weapon.baseDamage, `${path}.baseDamage`, issues);
    requirePositive(weapon.cooldown, `${path}.cooldown`, issues);
    requirePositive(weapon.minCooldown, `${path}.minCooldown`, issues);
    if (isFiniteNumber(weapon.cooldown) && isFiniteNumber(weapon.minCooldown)
      && weapon.cooldown < weapon.minCooldown) {
      issues.push(`${path}.cooldown must be greater than or equal to minCooldown`);
    }
    requirePositiveInteger(weapon.projectileCount, `${path}.projectileCount`, issues);
    requirePositiveInteger(weapon.maxProjectileCount, `${path}.maxProjectileCount`, issues);
    requirePositiveInteger(weapon.maxActiveProjectiles, `${path}.maxActiveProjectiles`, issues);
    requireNonNegative(weapon.projectileSpreadDegrees, `${path}.projectileSpreadDegrees`, issues);
    if (Number.isInteger(weapon.projectileCount) && Number.isInteger(weapon.maxProjectileCount)
      && weapon.projectileCount > weapon.maxProjectileCount) {
      issues.push(`${path}.projectileCount must not exceed maxProjectileCount`);
    }
    requirePositive(weapon.attackRadius, `${path}.attackRadius`, issues);
    requirePositive(weapon.targetRetryInterval, `${path}.targetRetryInterval`, issues);
  }

  for (const wave of config.spawnWaves) {
    validateWave(wave, monsterIds, issues);
  }

  for (const stage of config.stages) {
    const path = `stages[${stage.id}]`;
    requireNonBlank(stage.displayName, `${path}.displayName`, issues);
    requireReference(stage.chapterId, chapterIds, `${path}.chapterId`, issues);
    // 双向一致：关卡声称的章节必须把它收录进 stageIds。
    const owningChapter = config.chapters.find((candidate) => candidate.id === stage.chapterId);
    if (owningChapter !== undefined && owningChapter.stageIds.indexOf(stage.id) === -1) {
      issues.push(`stages[${stage.id}].chapterId "${stage.chapterId}" does not list this stage`);
    }
    requirePositive(stage.duration, `${path}.duration`, issues);
    requirePositiveInteger(stage.activeMonsterSoftCap, `${path}.activeMonsterSoftCap`, issues);
    requirePositiveInteger(stage.activeMonsterHardCap, `${path}.activeMonsterHardCap`, issues);
    if (Number.isInteger(stage.activeMonsterSoftCap)
      && Number.isInteger(stage.activeMonsterHardCap)
      && stage.activeMonsterSoftCap > stage.activeMonsterHardCap) {
      issues.push(`${path}.activeMonsterSoftCap must not exceed activeMonsterHardCap`);
    }
    requirePositive(stage.spawnMinRadius, `${path}.spawnMinRadius`, issues);
    requirePositive(stage.spawnMaxRadius, `${path}.spawnMaxRadius`, issues);
    if (isFiniteNumber(stage.spawnMinRadius) && isFiniteNumber(stage.spawnMaxRadius)
      && stage.spawnMinRadius >= stage.spawnMaxRadius) {
      issues.push(`${path}.spawnMinRadius must be less than spawnMaxRadius`);
    }
    validateBounds(stage.playArea, `${path}.playArea`, issues);
    requireNonEmptyArray(stage.waveIds, `${path}.waveIds`, issues);
    if (stage.bossId !== null) {
      requireReference(stage.bossId, bossIds, `${path}.bossId`, issues);
    }
    validateStarConditions(stage.starConditions, `${path}.starConditions`, issues);
    validateStageDifficulties(stage.difficulties, `${path}.difficulties`, issues);
    validateMilestoneGrant(stage.milestoneRewards.firstClear, `${path}.milestoneRewards.firstClear`, resourceIds, issues);
    if (stage.milestoneRewards.perStar.length !== 3) {
      issues.push(`${path}.milestoneRewards.perStar length must be 3`);
    }
    stage.milestoneRewards.perStar.forEach((grant, index) => {
      validateMilestoneGrant(grant, `${path}.milestoneRewards.perStar[${index}]`, resourceIds, issues);
    });

    const seenWaveIds = new Set<ConfigId>();
    let previousStartTime = -Infinity;
    for (const waveId of stage.waveIds) {
      if (seenWaveIds.has(waveId)) {
        issues.push(`${path}.waveIds contains duplicate id "${waveId}"`);
      }
      seenWaveIds.add(waveId);
      requireReference(waveId, waveIds, `${path}.waveIds`, issues);

      const wave = config.spawnWaves.find((candidate) => candidate.id === waveId);
      if (wave !== undefined) {
        if (wave.startTime < previousStartTime) {
          issues.push(`${path}.waveIds must be ordered by wave startTime`);
        }
        if (isFiniteNumber(stage.duration) && wave.endTime > stage.duration) {
          issues.push(`${path} references wave "${waveId}" beyond stage duration`);
        }
        previousStartTime = wave.startTime;
      }
    }
  }

  for (const chapter of config.chapters) {
    const path = `chapters[${chapter.id}]`;
    requireNonBlank(chapter.displayName, `${path}.displayName`, issues);
    requireNonEmptyArray(chapter.stageIds, `${path}.stageIds`, issues);
    const seenStageIds = new Set<ConfigId>();
    for (const stageId of chapter.stageIds) {
      requireReference(stageId, stageIds, `${path}.stageIds`, issues);
      if (seenStageIds.has(stageId)) {
        issues.push(`${path}.stageIds contains duplicate id "${stageId}"`);
      }
      seenStageIds.add(stageId);
      // stage.chapterId 与章节 stageIds 必须双向一致（章节归属唯一）。
      const stage = config.stages.find((candidate) => candidate.id === stageId);
      if (stage !== undefined && stage.chapterId !== chapter.id) {
        issues.push(`${path}.stageIds contains stage "${stageId}" whose chapterId is "${stage.chapterId}"`);
      }
    }
    if (chapter.requiredChapterId !== null) {
      requireReference(chapter.requiredChapterId, chapterIds, `${path}.requiredChapterId`, issues);
    }
  }
  validateChapterUnlockChain(config.chapters, issues);

  validateLevelCurve(config.levelCurve, 'levelCurve', issues);
  validateLevelCurve(config.playerLevel.levelCurve, 'playerLevel.levelCurve', issues);

  for (const upgrade of config.upgrades) {
    const path = `upgrades[${upgrade.id}]`;
    requireNonBlank(upgrade.title, `${path}.title`, issues);
    requireNonBlank(upgrade.description, `${path}.description`, issues);
    requirePositiveInteger(upgrade.maxStacks, `${path}.maxStacks`, issues);
    requirePositive(upgrade.weight, `${path}.weight`, issues);
    requireNonEmptyArray(upgrade.effects, `${path}.effects`, issues);
    upgrade.effects.forEach((effect, index) => {
      validateUpgradeEffect(effect, `${path}.effects[${index}]`, issues);
    });
  }

  return issues;
}

export function assertValidGameConfig(config: GameConfig): void {
  const issues = validateGameConfig(config);
  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }
}

function collectIds<T extends { readonly id: ConfigId }>(
  entries: readonly T[],
  tableName: string,
  issues: string[],
): ReadonlySet<ConfigId> {
  const ids = new Set<ConfigId>();
  for (const entry of entries) {
    requireConfigId(entry.id, `${tableName}.id`, issues);
    if (ids.has(entry.id)) {
      issues.push(`${tableName} contains duplicate id "${entry.id}"`);
    }
    ids.add(entry.id);
  }
  return ids;
}

/**
 * 活动配置校验（V08-16）：类型合法、内容引用非空、开关 ID 合法、窗口 dayKey 格式与顺序。
 */
function validateActivity(activity: ActivityConfig, issues: string[]): void {
  const path = `activities[${activity.id}]`;
  requireNonBlank(activity.displayName, `${path}.displayName`, issues);
  if (activity.type !== 'login') {
    issues.push(`${path}.type must be "login" in V0.8`);
  }
  requireConfigId(activity.contentRef, `${path}.contentRef`, issues);
  requireConfigId(activity.featureFlag, `${path}.featureFlag`, issues);
  if (activity.window !== null) {
    const dayKeyPattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!dayKeyPattern.test(activity.window.startDayKey) || !dayKeyPattern.test(activity.window.endDayKey)) {
      issues.push(`${path}.window keys must be yyyy-MM-dd dayKeys`);
    } else if (activity.window.startDayKey > activity.window.endDayKey) {
      issues.push(`${path}.window startDayKey must not be after endDayKey`);
    }
  }
}

/**
 * 功能解锁表校验（V10-02）：ID 稳定唯一（id 与 featureId 双唯一）、条件结构与参数
 * 合法、关卡/章节引用存在、show_condition 必须携带条件文案、开关 ID 为 snake_case
 * （运行时未知开关按关闭处理——安全默认值，与活动开关同规则）。
 */
function validateUnlocks(
  unlocks: readonly UnlockConfig[],
  stages: readonly { readonly id: ConfigId }[],
  chapters: readonly { readonly id: ConfigId }[],
  issues: string[],
): void {
  const ids = new Set<string>();
  const featureIds = new Set<string>();
  for (const unlock of unlocks) {
    const path = `unlocks[${unlock.id}]`;
    requireConfigId(unlock.id, `${path}.id`, issues);
    if (ids.has(unlock.id)) {
      issues.push(`unlocks contains duplicate id "${unlock.id}"`);
    }
    ids.add(unlock.id);
    requireConfigId(unlock.featureId, `${path}.featureId`, issues);
    if (featureIds.has(unlock.featureId)) {
      issues.push(`unlocks contains duplicate featureId "${unlock.featureId}"`);
    }
    featureIds.add(unlock.featureId);
    if (unlock.lockedBehavior !== 'hide' && unlock.lockedBehavior !== 'show_condition') {
      issues.push(`${path}.lockedBehavior must be "hide" or "show_condition"`);
    }
    if (unlock.lockedBehavior === 'show_condition') {
      requireNonBlank(unlock.lockedText, `${path}.lockedText`, issues);
    }
    if (unlock.featureFlag !== null) {
      requireConfigId(unlock.featureFlag, `${path}.featureFlag`, issues);
    }
    const conditionKind = unlock.condition.kind;
    switch (conditionKind) {
      case 'always':
        break;
      case 'playerLevel': {
        const level = unlock.condition.level;
        if (level < 1) {
          issues.push(`${path}.condition.level must be a positive integer`);
        }
        break;
      }
      case 'stageClear': {
        const stageId = unlock.condition.stageId;
        if (!stages.some((stage) => stage.id === stageId)) {
          issues.push(`${path}.condition.stageId references missing id "${stageId}"`);
        }
        break;
      }
      case 'chapterClear': {
        const chapterId = unlock.condition.chapterId;
        if (!chapters.some((chapter) => chapter.id === chapterId)) {
          issues.push(`${path}.condition.chapterId references missing id "${chapterId}"`);
        }
        break;
      }
      case 'realmIndex': {
        const realmIndex = unlock.condition.realmIndex;
        if (realmIndex < 0) {
          issues.push(`${path}.condition.realmIndex must be a non-negative integer`);
        }
        break;
      }
      case 'accountAgeDays': {
        const days = unlock.condition.days;
        if (days < 0) {
          issues.push(`${path}.condition.days must be a non-negative integer`);
        }
        break;
      }
      default:
        issues.push(`${path}.condition has unsupported kind: ${String(conditionKind)}`);
    }
  }
}

/**
 * 强引导步骤白名单（V10-03，GAME_LOOP §5"强制步骤只用于不可逆或首次核心操作"）：
 * 首发仅移动/三选一/首次培养可为 strong；新增强引导步骤必须显式扩展本白名单
 * （代码评审卡点，防止引导改版把任意内容步骤设为阻塞）。
 */
const GUIDE_STRONG_STEP_WHITELIST: ReadonlySet<string> = new Set([
  'guide_move',
  'guide_levelup',
  'guide_cultivate',
]);

/**
 * 引导脚本校验（V10-03）：版本正整数、步骤 ID 唯一、入口/后继引用存在、
 * 从入口沿 nextStepId 恰好线性走遍全部步骤（无环、无孤儿）；strong 步骤必须在
 * 白名单内且不可跳过（可跳过步骤不阻塞战斗的语义由本规则与运行时双保险）。
 */
function validateGuideScript(script: GuideScriptConfig, issues: string[]): void {
  if (!Number.isInteger(script.version) || script.version < 1) {
    issues.push('guide.version must be a positive integer');
  }
  if (typeof script.enabled !== 'boolean') {
    issues.push('guide.enabled must be a boolean');
  }
  const stepIds = new Set<string>();
  for (const step of script.steps) {
    const path = `guide.steps[${step.id}]`;
    requireConfigId(step.id, `${path}.id`, issues);
    if (stepIds.has(step.id)) {
      issues.push(`guide.steps contains duplicate id "${step.id}"`);
    }
    stepIds.add(step.id);
    requireNonBlank(step.displayName, `${path}.displayName`, issues);
    requireNonBlank(step.description, `${path}.description`, issues);
    requireNonBlank(step.anchorId, `${path}.anchorId`, issues);
    if (step.type !== 'strong' && step.type !== 'weak' && step.type !== 'info') {
      issues.push(`${path}.type must be "strong", "weak" or "info"`);
    }
    if (step.scene !== 'battle' && step.scene !== 'home') {
      issues.push(`${path}.scene must be "battle" or "home"`);
    }
    if (step.type === 'strong' && !GUIDE_STRONG_STEP_WHITELIST.has(step.id)) {
      issues.push(`${path}.type "strong" is reserved for first-core-operation steps ${Array.from(GUIDE_STRONG_STEP_WHITELIST).join('/')}`);
    }
    if (step.skippable && step.type === 'strong') {
      issues.push(`${path}.skippable steps must not be "strong" (skippable guidance never blocks battle)`);
    }
    if (step.nextStepId !== null && !script.steps.some((candidate) => candidate.id === step.nextStepId)) {
      issues.push(`${path}.nextStepId references missing id "${step.nextStepId}"`);
    }
  }
  if (!stepIds.has(script.entryStepId)) {
    issues.push(`guide.entryStepId references missing id "${script.entryStepId}"`);
    return;
  }
  // 线性链完整性：从入口走 nextStepId 必须恰好 visiting 全部步骤（无环、无孤儿）。
  const byId = new Map(script.steps.map((step) => [step.id, step]));
  const visited = new Set<string>();
  let cursor: GuideScriptConfig['steps'][number] | undefined = byId.get(script.entryStepId);
  while (cursor !== undefined && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    cursor = cursor.nextStepId !== null ? byId.get(cursor.nextStepId) : undefined;
  }
  if (visited.size !== script.steps.length) {
    const orphan = script.steps.filter((step) => !visited.has(step.id)).map((step) => step.id);
    issues.push(`guide.steps must form a single linear chain from entry; unreachable: ${orphan.join(', ')}`);
  }
}

/**
 * 广告配置校验（V10-10）：投放 ID 唯一且类型合法、复活的投放引用存在、
 * 次数/秒数/比例为正且比例在 [0,1]、不可用关卡引用存在。
 */
function validateAds(
  config: AdConfig,
  stages: readonly { readonly id: ConfigId }[],
  resourceIds: ReadonlySet<ConfigId>,
  issues: string[],
): void {
  const placementIds = new Set<string>();
  for (const placement of config.placements) {
    const path = `ads.placements[${placement.id}]`;
    requireConfigId(placement.id, `${path}.id`, issues);
    if (placementIds.has(placement.id)) {
      issues.push(`ads.placements contains duplicate id "${placement.id}"`);
    }
    placementIds.add(placement.id);
    if (placement.type !== 'rewarded') {
      issues.push(`${path}.type must be "rewarded" in V1.0`);
    }
    if (typeof placement.adUnitId !== 'string') {
      issues.push(`${path}.adUnitId must be a string (empty until configured)`);
    }
  }
  const bonus = config.settlementBonus;
  const bonusPath = 'ads.settlementBonus';
  if (!placementIds.has(bonus.placementId)) {
    issues.push(`${bonusPath}.placementId references missing id "${bonus.placementId}"`);
  }
  if (typeof bonus.rewardMultiplier !== 'number' || bonus.rewardMultiplier <= 1) {
    issues.push(`${bonusPath}.rewardMultiplier must be a number greater than 1`);
  }
  if (!Number.isInteger(bonus.maxPerDay) || bonus.maxPerDay < 0) {
    issues.push(`${bonusPath}.maxPerDay must be a non-negative integer`);
  }
  if (bonus.results.length === 0 || bonus.results.some((r) => r !== 'victory' && r !== 'defeat' && r !== 'abort')) {
    issues.push(`${bonusPath}.results must be a non-empty subset of victory/defeat/abort`);
  }

  const daily = config.dailyResource;
  const dailyPath = 'ads.dailyResource';
  if (!placementIds.has(daily.placementId)) {
    issues.push(`${dailyPath}.placementId references missing id "${daily.placementId}"`);
  }
  const resourceIdsSet = new Set(resourceIds);
  for (const resourceId of Object.keys(daily.resources)) {
    const amount: unknown = daily.resources[resourceId];
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      issues.push(`${dailyPath}.resources[${resourceId}] must be a positive integer`);
    }
    if (!resourceIdsSet.has(resourceId)) {
      issues.push(`${dailyPath}.resources references missing id "${resourceId}"`);
    }
  }
  if (!Number.isInteger(daily.maxPerDay) || daily.maxPerDay < 0) {
    issues.push(`${dailyPath}.maxPerDay must be a non-negative integer`);
  }
  if (!Number.isInteger(daily.cooldownMinutes) || daily.cooldownMinutes < 0) {
    issues.push(`${dailyPath}.cooldownMinutes must be a non-negative integer`);
  }

  const reroll = config.reroll;
  const rerollPath = 'ads.reroll';
  if (!placementIds.has(reroll.placementId)) {
    issues.push(`${rerollPath}.placementId references missing id "${reroll.placementId}"`);
  }
  if (!Number.isInteger(reroll.maxPerBattle) || reroll.maxPerBattle < 0) {
    issues.push(`${rerollPath}.maxPerBattle must be a non-negative integer`);
  }

  const revive = config.revive;
  const path = 'ads.revive';
  if (!placementIds.has(revive.placementId)) {
    issues.push(`${path}.placementId references missing id "${revive.placementId}"`);
  }
  if (!Number.isInteger(revive.maxPerBattle) || revive.maxPerBattle < 0) {
    issues.push(`${path}.maxPerBattle must be a non-negative integer`);
  }
  if (!Number.isInteger(revive.maxPerDay) || revive.maxPerDay < 0) {
    issues.push(`${path}.maxPerDay must be a non-negative integer`);
  }
  if (typeof revive.invulnerableSeconds !== 'number' || revive.invulnerableSeconds <= 0) {
    issues.push(`${path}.invulnerableSeconds must be a positive number`);
  }
  if (typeof revive.hpRestoreRatio !== 'number' || revive.hpRestoreRatio < 0 || revive.hpRestoreRatio > 1) {
    issues.push(`${path}.hpRestoreRatio must be a number in [0, 1]`);
  }
  const stageIds = new Set(stages.map((stage) => stage.id));
  for (const stageId of revive.disabledStageIds) {
    if (!stageIds.has(stageId)) {
      issues.push(`${path}.disabledStageIds references missing id "${stageId}"`);
    }
  }
}

/**
 * 音频配置校验（V10-05）：四组各一条且不重复、音量 0～100、并发上限正整数、
 * 节流非负、剪辑 ID 唯一且引用已声明分组。
 */
function validateAudio(config: AudioConfig, issues: string[]): void {
  const CHANNEL_IDS: ReadonlySet<string> = new Set(['bgm', 'skill', 'hit', 'ui']);
  const seenChannels = new Set<string>();
  for (const channel of config.channels) {
    const path = `audio.channels[${channel.channel}]`;
    if (!CHANNEL_IDS.has(channel.channel)) {
      issues.push(`${path} is not a known channel`);
    }
    if (seenChannels.has(channel.channel)) {
      issues.push(`audio.channels contains duplicate channel "${channel.channel}"`);
    }
    seenChannels.add(channel.channel);
    if (!Number.isInteger(channel.volume) || channel.volume < 0 || channel.volume > 100) {
      issues.push(`${path}.volume must be an integer in [0, 100]`);
    }
    if (!Number.isInteger(channel.maxConcurrent) || channel.maxConcurrent < 1) {
      issues.push(`${path}.maxConcurrent must be a positive integer`);
    }
    if (!Number.isInteger(channel.minIntervalMs) || channel.minIntervalMs < 0) {
      issues.push(`${path}.minIntervalMs must be a non-negative integer`);
    }
  }
  const clipIds = new Set<string>();
  for (const clip of config.clips) {
    const path = `audio.clips[${clip.id}]`;
    requireConfigId(clip.id, `${path}.id`, issues);
    if (clipIds.has(clip.id)) {
      issues.push(`audio.clips contains duplicate id "${clip.id}"`);
    }
    clipIds.add(clip.id);
    if (!seenChannels.has(clip.channel)) {
      issues.push(`${path}.channel references undeclared channel "${clip.channel}"`);
    }
  }
}

/** 礼包配置校验（V08-15）：解锁条件结构与数值、contents 引用、前置链引用与成环。 */
function validateOffer(
  offer: OfferConfig,
  offers: readonly OfferConfig[],
  offerIds: ReadonlySet<ConfigId>,
  chapters: readonly ChapterConfig[],
  resourceIds: ReadonlySet<ConfigId>,
  issues: string[],
): void {
  const path = `offers[${offer.id}]`;
  requireNonBlank(offer.displayName, `${path}.displayName`, issues);
  requireNonBlank(offer.description, `${path}.description`, issues);
  if (offer.priceType !== 'free' || offer.price !== 0) {
    issues.push(`${path} must be a free offer (priceType "free", price 0) in V0.8`);
  }
  if (offer.purchaseLimit !== 1) {
    issues.push(`${path}.purchaseLimit must be 1 for free offers`);
  }
  const condition = offer.unlockCondition;
  if (condition.kind === 'playerLevel') {
    requirePositiveInteger(condition.level, `${path}.unlockCondition.level`, issues);
  } else if (condition.kind === 'realmIndex') {
    requireNonNegativeInteger(condition.realmIndex, `${path}.unlockCondition.realmIndex`, issues);
  } else if (condition.kind === 'chapterClear') {
    const chapter = chapters.find((candidate) => candidate.id === condition.chapterId);
    if (chapter === undefined) {
      issues.push(`${path}.unlockCondition.chapterId references missing id "${condition.chapterId}"`);
    }
  } else {
    issues.push(`${path}.unlockCondition has unsupported kind: ${String((condition as { kind: unknown }).kind)}`);
  }
  requireNonNegativeInteger(offer.contents.accountXp, `${path}.contents.accountXp`, issues);
  for (const resourceId of Object.keys(offer.contents.resources)) {
    requireReference(resourceId, resourceIds, `${path}.contents.resources`, issues);
    requirePositiveInteger(offer.contents.resources[resourceId] as number, `${path}.contents.resources[${resourceId}]`, issues);
  }
  if (offer.prerequisiteOfferId !== null) {
    requireReference(offer.prerequisiteOfferId, offerIds, `${path}.prerequisiteOfferId`, issues);
  }
  const visited = new Set<ConfigId>([offer.id]);
  let cursor = offer.prerequisiteOfferId;
  while (cursor !== null) {
    if (visited.has(cursor)) {
      issues.push(`offers[${offer.id}] prerequisite chain contains a cycle at "${cursor}"`);
      break;
    }
    visited.add(cursor);
    const prerequisite = offers.find((candidate) => candidate.id === cursor);
    cursor = prerequisite?.prerequisiteOfferId ?? null;
  }
}

/** 累计登录奖励校验（V08-14）：档位 day 从 1 连续递增至 totalDays、奖励引用合法。 */
function validateLoginRewards(
  config: LoginRewardConfig,
  resourceIds: ReadonlySet<ConfigId>,
  issues: string[],
): void {
  requirePositiveInteger(config.totalDays, 'loginRewards.totalDays', issues);
  if (config.tiers.length !== config.totalDays) {
    issues.push(`loginRewards.tiers length must equal totalDays (${config.totalDays})`);
  }
  config.tiers.forEach((tier, index) => {
    const expectedDay = index + 1;
    if (tier.day !== expectedDay) {
      issues.push(`loginRewards.tiers[${index}].day must be ${expectedDay}`);
    }
    requireNonNegativeInteger(tier.reward.accountXp, `loginRewards.tiers[${index}].reward.accountXp`, issues);
    for (const resourceId of Object.keys(tier.reward.resources)) {
      requireReference(resourceId, resourceIds, `loginRewards.tiers[${index}].reward.resources`, issues);
      requirePositiveInteger(tier.reward.resources[resourceId] as number, `loginRewards.tiers[${index}].reward.resources[${resourceId}]`, issues);
    }
  });
}

/** 商品配置校验（V08-12）：内容资源引用、单币种价格、限购正整数、刷新标记布尔。 */
function validateShopItem(
  item: ShopItemConfig,
  resourceIds: ReadonlySet<ConfigId>,
  issues: string[],
): void {
  const path = `shopItems[${item.id}]`;
  requireNonBlank(item.displayName, `${path}.displayName`, issues);
  requireNonBlank(item.description, `${path}.description`, issues);
  requireReference(item.goods.resourceId, resourceIds, `${path}.goods.resourceId`, issues);
  requirePositiveInteger(item.goods.amount, `${path}.goods.amount`, issues);
  requireReference(item.priceType, resourceIds, `${path}.priceType`, issues);
  requirePositiveInteger(item.price, `${path}.price`, issues);
  requirePositiveInteger(item.purchaseLimit, `${path}.purchaseLimit`, issues);
  if (typeof item.dailyRefresh !== 'boolean') {
    issues.push(`${path}.dailyRefresh must be a boolean`);
  }
}

/** 商品组校验（V08-12）：商品引用存在且组内不重复。 */
function validateShopGroup(
  group: ShopGroupConfig,
  shopItemIds: ReadonlySet<ConfigId>,
  issues: string[],
): void {
  const path = `shopGroups[${group.id}]`;
  requireNonBlank(group.displayName, `${path}.displayName`, issues);
  requireNonEmptyArray(group.itemIds, `${path}.itemIds`, issues);
  const seen = new Set<ConfigId>();
  for (const itemId of group.itemIds) {
    requireReference(itemId, shopItemIds, `${path}.itemIds`, issues);
    if (seen.has(itemId)) {
      issues.push(`${path}.itemIds contains duplicate id "${itemId}"`);
    }
    seen.add(itemId);
  }
}

/** 成就配置校验（V08-10）：条件结构、档位升序且目标正整数、奖励引用、hidden 布尔。 */
function validateAchievement(
  achievement: AchievementConfig,
  resourceIds: ReadonlySet<ConfigId>,
  issues: string[],
): void {
  const path = `achievements[${achievement.id}]`;
  requireNonBlank(achievement.displayName, `${path}.displayName`, issues);
  requireNonBlank(achievement.description, `${path}.description`, issues);
  if (typeof achievement.hidden !== 'boolean') {
    issues.push(`${path}.hidden must be a boolean`);
  }
  const conditionPath = `${path}.condition`;
  if (achievement.condition.kind === 'spendResource') {
    requireReference(achievement.condition.resourceId, resourceIds, `${conditionPath}.resourceId`, issues);
  } else if (
    achievement.condition.kind !== 'killCount'
    && achievement.condition.kind !== 'clearCount'
    && achievement.condition.kind !== 'collectXp'
    && achievement.condition.kind !== 'levelUpCount'
  ) {
    issues.push(`${conditionPath} has unsupported condition kind: ${String((achievement.condition as { kind: unknown }).kind)}`);
  }
  requireNonEmptyArray(achievement.tiers, `${path}.tiers`, issues);
  let previousTarget = 0;
  achievement.tiers.forEach((tier, index) => {
    requirePositiveInteger(tier.target, `${path}.tiers[${index}].target`, issues);
    if (index > 0 && tier.target <= previousTarget) {
      issues.push(`${path}.tiers[${index}].target must be greater than tiers[${index - 1}].target`);
    }
    previousTarget = tier.target;
    requireNonNegativeInteger(tier.reward.accountXp, `${path}.tiers[${index}].reward.accountXp`, issues);
    for (const resourceId of Object.keys(tier.reward.resources)) {
      requireReference(resourceId, resourceIds, `${path}.tiers[${index}].reward.resources`, issues);
      requirePositiveInteger(tier.reward.resources[resourceId] as number, `${path}.tiers[${index}].reward.resources[${resourceId}]`, issues);
    }
  });
}

/** 任务配置校验（V08-08）：周期合法、条件结构与目标值、奖励资源引用、前置链引用与成环。 */
function validateTask(
  task: TaskConfig,
  tasks: readonly TaskConfig[],
  taskIds: ReadonlySet<ConfigId>,
  resourceIds: ReadonlySet<ConfigId>,
  issues: string[],
): void {
  const path = `tasks[${task.id}]`;
  requireNonBlank(task.displayName, `${path}.displayName`, issues);
  requireNonBlank(task.description, `${path}.description`, issues);
  if (task.period !== 'main' && task.period !== 'daily' && task.period !== 'weekly') {
    issues.push(`${path}.period must be one of main/daily/weekly`);
  }
  const conditionPath = `${path}.condition`;
  if (task.condition.kind === 'spendResource') {
    requireReference(task.condition.resourceId, resourceIds, `${conditionPath}.resourceId`, issues);
    requirePositiveInteger(task.condition.target, `${conditionPath}.target`, issues);
  } else if (
    task.condition.kind === 'killCount'
    || task.condition.kind === 'clearCount'
    || task.condition.kind === 'collectXp'
    || task.condition.kind === 'levelUpCount'
  ) {
    requirePositiveInteger(task.condition.target, `${conditionPath}.target`, issues);
  } else {
    issues.push(`${conditionPath} has unsupported condition kind: ${String((task.condition as { kind: unknown }).kind)}`);
  }
  requireNonNegativeInteger(task.reward.accountXp, `${path}.reward.accountXp`, issues);
  for (const resourceId of Object.keys(task.reward.resources)) {
    requireReference(resourceId, resourceIds, `${path}.reward.resources`, issues);
    requirePositiveInteger(task.reward.resources[resourceId] as number, `${path}.reward.resources[${resourceId}]`, issues);
  }
  if (task.prerequisiteTaskId !== null) {
    requireReference(task.prerequisiteTaskId, taskIds, `${path}.prerequisiteTaskId`, issues);
  }
  // 前置链不成环。
  const visited = new Set<ConfigId>([task.id]);
  let cursor = task.prerequisiteTaskId;
  while (cursor !== null) {
    if (visited.has(cursor)) {
      issues.push(`tasks[${task.id}] prerequisite chain contains a cycle at "${cursor}"`);
      break;
    }
    visited.add(cursor);
    const prerequisite = tasks.find((candidate) => candidate.id === cursor);
    cursor = prerequisite?.prerequisiteTaskId ?? null;
  }
}

function validateChapterUnlockChain(
  chapters: readonly ChapterConfig[],
  issues: string[],
): void {
  for (const chapter of chapters) {
    const visited = new Set<ConfigId>([chapter.id]);
    let cursor = chapter.requiredChapterId;
    while (cursor !== null) {
      if (visited.has(cursor)) {
        issues.push(`chapters[${chapter.id}] requiredChapterId chain contains a cycle at "${cursor}"`);
        break;
      }
      visited.add(cursor);
      const required = chapters.find((candidate) => candidate.id === cursor);
      if (required === undefined) {
        break;
      }
      cursor = required.requiredChapterId;
    }
  }
}

/** 星级条件集校验：长度 3、第一星恒为通关、各条件类型数值合法。 */
function validateStarConditions(
  conditions: readonly StarCondition[],
  path: string,
  issues: string[],
): void {
  if (conditions.length !== 3) {
    issues.push(`${path} length must be 3`);
    return;
  }
  conditions.forEach((condition, index) => {
    const conditionPath = `${path}[${index}]`;
    if (condition.kind === 'clear') {
      if (index !== 0) {
        issues.push(`${conditionPath} kind "clear" is only allowed as the first (star 1) condition`);
      }
      return;
    }
    if (index === 0) {
      issues.push(`${conditionPath} must be kind "clear" (star 1 is always clear)`);
    }
    if (condition.kind === 'hpRatioAbove') {
      if (!isFiniteNumber(condition.ratio) || condition.ratio <= 0 || condition.ratio > 1) {
        issues.push(`${conditionPath}.ratio must be in (0, 1]`);
      }
      return;
    }
    if (condition.kind === 'timeUnder') {
      requirePositive(condition.seconds, `${conditionPath}.seconds`, issues);
      return;
    }
    if (condition.kind === 'hitTakenAtMost') {
      requireNonNegativeInteger(condition.count, `${conditionPath}.count`, issues);
      return;
    }
    issues.push(`${conditionPath} has unsupported condition kind: ${String((condition as { kind: unknown }).kind)}`);
  });
}

/** 难度档校验：ID 组内唯一、展示名非空、乘数为正、解锁链首档 0 / 后续档正整数。 */
function validateStageDifficulties(
  difficulties: readonly StageDifficultyConfig[],
  path: string,
  issues: string[],
): void {
  requireNonEmptyArray(difficulties, path, issues);
  const seenIds = new Set<ConfigId>();
  difficulties.forEach((difficulty, index) => {
    const difficultyPath = `${path}[${difficulty.id}]`;
    requireConfigId(difficulty.id, `${difficultyPath}.id`, issues);
    if (seenIds.has(difficulty.id)) {
      issues.push(`${path} contains duplicate id "${difficulty.id}"`);
    }
    seenIds.add(difficulty.id);
    requireNonBlank(difficulty.displayName, `${difficultyPath}.displayName`, issues);
    requirePositive(difficulty.hpMultiplier, `${difficultyPath}.hpMultiplier`, issues);
    requirePositive(difficulty.speedMultiplier, `${difficultyPath}.speedMultiplier`, issues);
    requirePositive(difficulty.contactDamageMultiplier, `${difficultyPath}.contactDamageMultiplier`, issues);
    requirePositive(difficulty.xpMultiplier, `${difficultyPath}.xpMultiplier`, issues);
    requirePositive(difficulty.rewardMultiplier, `${difficultyPath}.rewardMultiplier`, issues);
    if (index === 0) {
      if (difficulty.requiredStarsOnPrevious !== 0) {
        issues.push(`${difficultyPath}.requiredStarsOnPrevious must be 0 for the first difficulty`);
      }
    } else {
      requirePositiveInteger(difficulty.requiredStarsOnPrevious, `${difficultyPath}.requiredStarsOnPrevious`, issues);
    }
  });
}

/** 里程碑奖励校验：账号经验非负整数、资源引用存在且数量为正整数。 */
function validateMilestoneGrant(
  grant: StageMilestoneGrant,
  path: string,
  resourceIds: ReadonlySet<ConfigId>,
  issues: string[],
): void {
  requireNonNegativeInteger(grant.accountXp, `${path}.accountXp`, issues);
  for (const resourceId of Object.keys(grant.resources)) {
    requireReference(resourceId, resourceIds, `${path}.resources`, issues);
    requirePositiveInteger(grant.resources[resourceId] as number, `${path}.resources[${resourceId}]`, issues);
  }
}

/** 等级曲线通用校验：连续从 1 递增、每级所需经验为正整数；局内战斗与账号等级曲线共用。 */
function validateLevelCurve(
  curve: readonly LevelCurveEntry[],
  path: string,
  issues: string[],
): void {
  if (curve.length === 0) {
    issues.push(`${path} must contain at least one entry`);
  }
  curve.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    const expectedLevel = index + 1;
    if (entry.level !== expectedLevel) {
      issues.push(`${entryPath}.level must be ${expectedLevel}`);
    }
    requirePositiveInteger(entry.requiredXp, `${entryPath}.requiredXp`, issues);
  });
}

/** 大境界校验：小境界消耗非空且为正整数、maxHp 增量非负、突破条件引用存在且数值合法。 */
function validateRealm(
  realm: RealmConfig,
  isFinalRealm: boolean,
  resourceIds: ReadonlySet<ConfigId>,
  issues: string[],
): void {
  const path = `realms[${realm.id}]`;
  requireNonBlank(realm.displayName, `${path}.displayName`, issues);
  requireNonEmptyArray(realm.subRealmCosts, `${path}.subRealmCosts`, issues);
  realm.subRealmCosts.forEach((cost, index) => {
    requirePositiveInteger(cost, `${path}.subRealmCosts[${index}]`, issues);
  });
  requireNonNegativeInteger(realm.maxHpBonus, `${path}.maxHpBonus`, issues);
  if (realm.breakthrough === null) {
    if (!isFinalRealm) {
      issues.push(`${path}.breakthrough must not be null for non-final realms`);
    }
    return;
  }
  if (isFinalRealm) {
    issues.push(`${path}.breakthrough must be null for the final realm`);
  }
  const breakthroughPath = `${path}.breakthrough`;
  requirePositiveInteger(realm.breakthrough.xiuweiCost, `${breakthroughPath}.xiuweiCost`, issues);
  requireReference(realm.breakthrough.materialId, resourceIds, `${breakthroughPath}.materialId`, issues);
  requirePositiveInteger(realm.breakthrough.materialCost, `${breakthroughPath}.materialCost`, issues);
  requireNonNegativeInteger(realm.breakthrough.requiredPlayerLevel, `${breakthroughPath}.requiredPlayerLevel`, issues);
}

/** 法器培养校验：weaponId 引用唯一、消耗列表长度与上限匹配、每级增量为正、绝学预留 ID 唯一且合法。 */
function validateWeaponGrowth(
  growth: WeaponGrowthConfig,
  weaponIds: ReadonlySet<ConfigId>,
  issues: string[],
): void {
  const path = `weaponGrowth[${growth.weaponId}]`;
  requireReference(growth.weaponId, weaponIds, `${path}.weaponId`, issues);
  requirePositiveInteger(growth.maxLevel, `${path}.maxLevel`, issues);
  if (Number.isInteger(growth.maxLevel)
    && growth.levelUpCosts.length !== growth.maxLevel - 1) {
    issues.push(`${path}.levelUpCosts length must be maxLevel - 1 (${growth.maxLevel - 1})`);
  }
  growth.levelUpCosts.forEach((cost, index) => {
    requirePositiveInteger(cost, `${path}.levelUpCosts[${index}]`, issues);
  });
  requirePositiveInteger(growth.damagePerLevel, `${path}.damagePerLevel`, issues);
  const ultimateIds = new Set<ConfigId>();
  growth.ultimateIds.forEach((ultimateId, index) => {
    requireConfigId(ultimateId, `${path}.ultimateIds[${index}]`, issues);
    if (ultimateIds.has(ultimateId)) {
      issues.push(`${path}.ultimateIds contains duplicate id "${ultimateId}"`);
    }
    ultimateIds.add(ultimateId);
  });
}

/** 灵兽校验：灵魄资源引用、解锁/培养消耗数值、技能效果结构。 */
function validateBeast(
  beast: BeastConfig,
  resourceIds: ReadonlySet<ConfigId>,
  issues: string[],
): void {
  const path = `beasts[${beast.id}]`;
  requireNonBlank(beast.displayName, `${path}.displayName`, issues);
  requireReference(beast.soulResourceId, resourceIds, `${path}.soulResourceId`, issues);
  requireNonNegativeInteger(beast.unlockSoulCost, `${path}.unlockSoulCost`, issues);
  requireNonEmptyArray(beast.levelUpCosts, `${path}.levelUpCosts`, issues);
  beast.levelUpCosts.forEach((cost, index) => {
    requirePositiveInteger(cost, `${path}.levelUpCosts[${index}]`, issues);
  });
  requireNonEmptyArray(beast.starUpCosts, `${path}.starUpCosts`, issues);
  beast.starUpCosts.forEach((cost, index) => {
    requirePositiveInteger(cost, `${path}.starUpCosts[${index}]`, issues);
  });
  requireNonBlank(beast.skillDescription, `${path}.skillDescription`, issues);
  const skillPath = `${path}.skill`;
  if (beast.skill.kind === 'damageNearest') {
    requirePositive(beast.skill.intervalSeconds, `${skillPath}.intervalSeconds`, issues);
    requirePositiveInteger(beast.skill.damage, `${skillPath}.damage`, issues);
    requirePositiveInteger(beast.skill.projectileCount, `${skillPath}.projectileCount`, issues);
  } else if (beast.skill.kind === 'heal') {
    requirePositive(beast.skill.intervalSeconds, `${skillPath}.intervalSeconds`, issues);
    requirePositiveInteger(beast.skill.value, `${skillPath}.value`, issues);
  } else {
    issues.push(`${skillPath} has unsupported effect kind: ${String((beast.skill as { kind: unknown }).kind)}`);
  }
}

/** 结算奖励校验：关卡/资源引用存在、数量非负整数、保留比例在 [0,1]。 */
function validateStageReward(
  reward: StageRewardConfig,
  stageIds: ReadonlySet<ConfigId>,
  resourceIds: ReadonlySet<ConfigId>,
  issues: string[],
): void {
  const path = `stageRewards[${reward.stageId}]`;
  requireReference(reward.stageId, stageIds, `${path}.stageId`, issues);
  requireNonNegativeInteger(reward.accountXp, `${path}.accountXp`, issues);
  for (const resourceId of Object.keys(reward.resources)) {
    requireReference(resourceId, resourceIds, `${path}.resources`, issues);
    requireNonNegativeInteger(reward.resources[resourceId] as number, `${path}.resources[${resourceId}]`, issues);
  }
  if (Number.isFinite(reward.defeatRatio) && (reward.defeatRatio < 0 || reward.defeatRatio > 1)) {
    issues.push(`${path}.defeatRatio must be in [0, 1]`);
  }
  if (Number.isFinite(reward.abortRatio) && (reward.abortRatio < 0 || reward.abortRatio > 1)) {
    issues.push(`${path}.abortRatio must be in [0, 1]`);
  }
}

function validateWave(
  wave: SpawnWaveConfig,
  monsterIds: ReadonlySet<ConfigId>,
  issues: string[],
): void {  const path = `spawnWaves[${wave.id}]`;
  requireNonNegative(wave.startTime, `${path}.startTime`, issues);
  requirePositive(wave.endTime, `${path}.endTime`, issues);
  if (isFiniteNumber(wave.startTime) && isFiniteNumber(wave.endTime)
    && wave.endTime <= wave.startTime) {
    issues.push(`${path}.endTime must be greater than startTime`);
  }
  requirePositive(wave.spawnInterval, `${path}.spawnInterval`, issues);
  requirePositiveInteger(wave.batchSize, `${path}.batchSize`, issues);
  requireNonEmptyArray(wave.monsters, `${path}.monsters`, issues);
  wave.monsters.forEach((weightedMonster, index) => {
    const monsterPath = `${path}.monsters[${index}]`;
    requireReference(weightedMonster.monsterId, monsterIds, `${monsterPath}.monsterId`, issues);
    requirePositive(weightedMonster.weight, `${monsterPath}.weight`, issues);
    if (weightedMonster.elite !== undefined && typeof weightedMonster.elite !== 'boolean') {
      issues.push(`${monsterPath}.elite must be a boolean when present`);
    }
  });
}

function validateGongfaEffect(
  effect: GongfaEffect | undefined,
  path: string,
  issues: string[],
): void {
  if (effect === undefined) {
    issues.push(`${path} is missing`);
    return;
  }
  switch (effect.kind) {
    case 'addSwordQi':
      requirePositiveInteger(effect.value, `${path}.value`, issues);
      requirePositive(effect.intervalSeconds, `${path}.intervalSeconds`, issues);
      if (isFiniteNumber(effect.damageFactor) && (effect.damageFactor <= 0 || effect.damageFactor > 1)) {
        issues.push(`${path}.damageFactor must be in (0, 1]`);
      }
      return;
    case 'contactDamageReduction':
      if (isFiniteNumber(effect.value) && (effect.value <= 0 || effect.value >= 1)) {
        issues.push(`${path}.value must be in (0, 1)`);
      }
      return;
    default: {
      const unreachable: never = effect;
      issues.push(`${path} has unsupported effect kind: ${String(unreachable)}`);
    }
  }
}

function validateUpgradeEffect(
  effect: UpgradeEffect,
  path: string,
  issues: string[],
): void {
  switch (effect.kind) {
    case 'addSwordDamage':
    case 'addSwordCount':
      requirePositiveInteger(effect.value, `${path}.value`, issues);
      return;
    case 'multiplySwordCooldown':
      requirePositive(effect.value, `${path}.value`, issues);
      return;
    default: {
      const unreachable: never = effect;
      issues.push(`${path} has unsupported effect kind: ${String(unreachable)}`);
    }
  }
}

function validateBounds(
  bounds: GameConfig['stages'][number]['playArea'],
  path: string,
  issues: string[],
): void {
  requireFinite(bounds.minX, `${path}.minX`, issues);
  requireFinite(bounds.maxX, `${path}.maxX`, issues);
  requireFinite(bounds.minY, `${path}.minY`, issues);
  requireFinite(bounds.maxY, `${path}.maxY`, issues);
  if (isFiniteNumber(bounds.minX) && isFiniteNumber(bounds.maxX)
    && bounds.minX >= bounds.maxX) {
    issues.push(`${path}.minX must be less than maxX`);
  }
  if (isFiniteNumber(bounds.minY) && isFiniteNumber(bounds.maxY)
    && bounds.minY >= bounds.maxY) {
    issues.push(`${path}.minY must be less than maxY`);
  }
}

function requireReference(
  id: ConfigId,
  knownIds: ReadonlySet<ConfigId>,
  path: string,
  issues: string[],
): void {
  requireConfigId(id, path, issues);
  if (!knownIds.has(id)) {
    issues.push(`${path} references missing id "${id}"`);
  }
}

function requireConfigId(value: string, path: string, issues: string[]): void {
  if (!CONFIG_ID_PATTERN.test(value)) {
    issues.push(`${path} must be a snake_case config id`);
  }
}

function requireNonBlank(value: string, path: string, issues: string[]): void {
  if (value.trim().length === 0) {
    issues.push(`${path} must not be blank`);
  }
}

function requireNonEmptyArray(
  value: readonly unknown[],
  path: string,
  issues: string[],
): void {
  if (value.length === 0) {
    issues.push(`${path} must not be empty`);
  }
}

function requirePositive(value: number, path: string, issues: string[]): void {
  if (!isFiniteNumber(value) || value <= 0) {
    issues.push(`${path} must be a finite number greater than 0`);
  }
}

function requireFinite(value: number, path: string, issues: string[]): void {
  if (!isFiniteNumber(value)) {
    issues.push(`${path} must be a finite number`);
  }
}

function requireNonNegative(value: number, path: string, issues: string[]): void {
  if (!isFiniteNumber(value) || value < 0) {
    issues.push(`${path} must be a finite number greater than or equal to 0`);
  }
}

function requirePositiveInteger(value: number, path: string, issues: string[]): void {
  if (!Number.isInteger(value) || value <= 0) {
    issues.push(`${path} must be a positive integer`);
  }
}

function requireNonNegativeInteger(value: number, path: string, issues: string[]): void {
  if (!Number.isInteger(value) || value < 0) {
    issues.push(`${path} must be a non-negative integer`);
  }
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}
