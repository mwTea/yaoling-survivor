import type { BattleEventMap, EntityId, WorldPosition2D } from '../core/BattleEvents';

/**
 * 伤害/生命/死亡的纯 TS 运行时规则。
 *
 * 运行时类集中在本文件（同 pooling/Pools.ts 的先例）：Node 测试按文件直接
 * 加载 .ts，无法解析无扩展名的跨文件值导入，而 Creator 约定无扩展名导入。
 * TargetRegistry 因无值导入保持独立文件。
 */

// ---------------------------------------------------------------------------
// 伤害契约
// ---------------------------------------------------------------------------

/** MVP 伤害类型；预留扩展位，不提前实现公式系统。 */
export type DamageType = 'sword' | 'contact';

/** 伤害结算的唯一输入契约；结算入口必须先通过 validateDamageRequest。 */
export interface DamageRequest {
  readonly sourceEntityId: EntityId;
  readonly targetEntityId: EntityId;
  readonly amount: number;
  readonly damageType: DamageType;
}

export type DamageRejectReason = 'target_mismatch' | 'target_inactive' | 'target_dead';

export interface DamageResult {
  readonly status: 'applied' | 'rejected';
  readonly died: boolean;
  readonly reason?: DamageRejectReason;
}

export class DamageRequestError extends Error {
  public constructor(reason: string) {
    super(`Invalid damage request: ${reason}`);
    this.name = 'DamageRequestError';
  }
}

/** 伤害输入的唯一校验入口；非法请求在开发期立即失败并说明字段。 */
export function validateDamageRequest(request: DamageRequest): void {
  if (!Number.isInteger(request.sourceEntityId) || request.sourceEntityId < 0) {
    throw new DamageRequestError(`sourceEntityId must be a non-negative integer, got ${request.sourceEntityId}`);
  }
  if (!Number.isInteger(request.targetEntityId) || request.targetEntityId < 1) {
    throw new DamageRequestError(`targetEntityId must be an integer >= 1, got ${request.targetEntityId}`);
  }
  if (!Number.isInteger(request.amount) || request.amount < 0) {
    throw new DamageRequestError(`amount must be a non-negative integer, got ${request.amount}`);
  }
  if (request.damageType !== 'sword' && request.damageType !== 'contact') {
    throw new DamageRequestError(`unknown damageType "${String(request.damageType)}"`);
  }
}

// ---------------------------------------------------------------------------
// 生命值
// ---------------------------------------------------------------------------

/**
 * 纯 TS 生命值：只负责夹紧与存活判定，不理解死亡编排与事件。
 * 构造参数必须来自已校验配置；运行期伤害参数由 validateDamageRequest 把关。
 */
export class Health {
  private readonly maxHpValue: number;
  private currentHpValue: number;

  constructor(maxHp: number) {
    if (!Number.isInteger(maxHp) || maxHp < 1) {
      throw new Error(`Health maxHp must be an integer >= 1, got ${maxHp}`);
    }
    this.maxHpValue = maxHp;
    this.currentHpValue = maxHp;
  }

  public get maxHp(): number {
    return this.maxHpValue;
  }

  public get currentHp(): number {
    return this.currentHpValue;
  }

  public get isAlive(): boolean {
    return this.currentHpValue > 0;
  }

  /** 负数为治疗；统一夹紧到 [0, maxHp]，返回变化量（扣减为正）。 */
  public applyDamage(amount: number): number {
    const nextHp = Math.min(this.maxHpValue, Math.max(0, this.currentHpValue - amount));
    const applied = this.currentHpValue - nextHp;
    this.currentHpValue = nextHp;
    return applied;
  }
}

// ---------------------------------------------------------------------------
// 怪物死亡编排
// ---------------------------------------------------------------------------

export interface MonsterVitalsSinks {
  /** 死亡第一步：从目标注册表注销本次激活；宿主应同时使自身 entityId 失效。 */
  unregisterTarget(entityId: EntityId): void;
  /** 注销完成后发布一次 monsterDied 事实。 */
  publishMonsterDied(payload: BattleEventMap['monsterDied']): void;
  /** 事件发布后安全回池。 */
  returnToPool(): void;
}

/**
 * 单次激活的怪物生命与死亡编排。
 *
 * 死亡顺序固定：标记死亡 → 注销 → 发布一次 monsterDied → 回池。
 * 同帧多次致死只有第一次生效（hasDied 拒绝后续伤害）；
 * 目标 entityId 不匹配的请求被拒绝，保证过期引用无法误伤。
 * 每次激活由宿主新建实例，天然满足"回池再激活后 HP 完整、无旧死亡状态"。
 */
export class MonsterVitals {
  private readonly monsterId: string;
  private readonly xpValue: number;
  private readonly sinks: MonsterVitalsSinks;
  private health: Health;
  private hasDied = false;

  constructor(monsterId: string, maxHp: number, xpValue: number, sinks: MonsterVitalsSinks) {
    this.monsterId = monsterId;
    this.xpValue = xpValue;
    this.sinks = sinks;
    this.health = new Health(maxHp);
  }

  public get currentHp(): number {
    return this.health.currentHp;
  }

  public get isDead(): boolean {
    return this.hasDied;
  }

  public takeDamage(request: DamageRequest, activeEntityId: EntityId, position: WorldPosition2D): DamageResult {
    validateDamageRequest(request);
    if (request.targetEntityId !== activeEntityId) {
      return { status: 'rejected', died: false, reason: 'target_mismatch' };
    }
    if (this.hasDied || !this.health.isAlive) {
      return { status: 'rejected', died: false, reason: 'target_dead' };
    }

    this.health.applyDamage(request.amount);
    if (this.health.isAlive) {
      return { status: 'applied', died: false };
    }

    this.hasDied = true;
    this.sinks.unregisterTarget(activeEntityId);
    this.sinks.publishMonsterDied({
      entityId: activeEntityId,
      monsterId: this.monsterId,
      position: { x: position.x, y: position.y },
      xpValue: this.xpValue,
    });
    this.sinks.returnToPool();
    return { status: 'applied', died: true };
  }
}

// ---------------------------------------------------------------------------
// 玩家生命与受击编排
// ---------------------------------------------------------------------------


/** 玩家受击参数（全部来自冻结配置）。 */
export interface PlayerVitalsConfig {
  readonly maxHp: number;
  readonly invulnerableSeconds: number;
}

/** 玩家死亡编排出口；由战局宿主装配。 */
export interface PlayerVitalsSinks {
  /** 死亡第一步：使玩家不再可受击/可交互（宿主同时停止输入表现）。 */
  markPlayerDead(): void;
  /** 注销完成后发布一次 playerDied 事实。 */
  publishPlayerDied(payload: BattleEventMap['playerDied']): void;
}

/**
 * 玩家生命与受击编排（纯 TS，不依赖 cc）。
 *
 * 受击走统一 DamageRequest 校验入口（damageType 'contact'）；
 * 受击后进入配置化无敌帧（同一怪物持续贴脸不重复扣血）；
 * 死亡幂等：归零只发生一次，顺序固定 标记死亡 → 发布 playerDied →
 * 由战局宿主将状态转 Ended（模拟冻结）。
 */
export class PlayerVitals {
  private readonly invulnerableSeconds: number;
  private readonly sinks: PlayerVitalsSinks;
  private health: Health;
  private invulnerableRemaining = 0;
  private hasDied = false;

  constructor(config: PlayerVitalsConfig, sinks: PlayerVitalsSinks) {
    this.invulnerableSeconds = config.invulnerableSeconds;
    this.sinks = sinks;
    this.health = new Health(config.maxHp);
  }

  public get currentHp(): number {
    return this.health.currentHp;
  }

  public get maxHp(): number {
    return this.health.maxHp;
  }

  public get isDead(): boolean {
    return this.hasDied;
  }

  public get isInvulnerable(): boolean {
    return this.invulnerableRemaining > 0;
  }

  /** 每帧推进无敌帧；暂停时 delta 为 0 自然冻结。 */
  public advance(deltaTime: number): void {
    if (deltaTime <= 0 || this.invulnerableRemaining <= 0) {
      return;
    }
    this.invulnerableRemaining = Math.max(0, this.invulnerableRemaining - deltaTime);
  }

  /** 回复生命并夹紧到 [0, maxHp]；死亡后拒绝。返回实际回复量。 */
  public heal(amount: number): number {
    if (this.hasDied || !this.health.isAlive) {
      return 0;
    }
    const before = this.health.currentHp;
    this.health.applyDamage(-amount);
    return this.health.currentHp - before;
  }

  /**
   * 复活（V10-10 广告复活）：仅在已死亡态有效——解除死亡标记、回复指定生命
   * （夹紧到 [0, maxHp]）并进入无敌帧。未死亡时调用为幂等 no-op。
   */
  public reviveWith(hpAmount: number, invulnerableSeconds: number): boolean {
    if (!this.hasDied) {
      return false;
    }
    this.hasDied = false;
    this.health.applyDamage(-Math.max(0, hpAmount));
    this.invulnerableRemaining = Math.max(this.invulnerableRemaining, Math.max(0, invulnerableSeconds));
    return true;
  }

  /**
   * 结算一次接触伤害；无敌帧内或已死亡时拒绝（不消耗无敌帧）。
   * 伤害致死时按固定顺序编排死亡并返回 died=true。
   */
  public takeContactDamage(
    request: DamageRequest,
    invulnerableEntityId: EntityId,
    position: WorldPosition2D,
  ): DamageResult {
    validateDamageRequest(request);
    if (request.targetEntityId !== invulnerableEntityId) {
      return { status: 'rejected', died: false, reason: 'target_mismatch' };
    }
    if (this.hasDied || !this.health.isAlive) {
      return { status: 'rejected', died: false, reason: 'target_dead' };
    }
    if (this.isInvulnerable) {
      return { status: 'rejected', died: false, reason: 'target_inactive' };
    }

    this.health.applyDamage(request.amount);
    if (this.health.isAlive) {
      this.invulnerableRemaining = this.invulnerableSeconds;
      return { status: 'applied', died: false };
    }

    this.hasDied = true;
    this.sinks.markPlayerDead();
    // 复用死亡事件结构；monsterId 固定 'player' 标识玩家死亡来源，xpValue 恒 0。
    this.sinks.publishPlayerDied({
      entityId: request.targetEntityId,
      monsterId: 'player',
      position: { x: position.x, y: position.y },
      xpValue: 0,
    });
    return { status: 'applied', died: true };
  }
}
