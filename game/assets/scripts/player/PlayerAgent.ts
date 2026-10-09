import { _decorator, Component } from 'cc';

import { BattleController } from '../battle/BattleController';
import { applyArtSprite } from '../ui/ArtLoader';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { EMPTY_BATTLE_LOADOUT } from '../account/LoadoutBuilder';
import type { BattleLoadoutSnapshot } from '../account/LoadoutBuilder';
import { PlayerVitals } from '../combat/Combat';
import type { DamageRequest, DamageResult } from '../combat/Combat';
import { TargetRegistryComponent } from '../combat/TargetRegistryComponent';
import type { TargetRegistry } from '../combat/TargetRegistry';
import type { PlayerCombatStats } from '../combat/PlayerCombatStats';
import { MonsterAgent } from '../monster/MonsterAgent';
import { ProgressionSystem } from '../progression/ProgressionSystem';
import type { TreasureRuntime } from '../progression/TreasureRuntime';

const { ccclass, property } = _decorator;

/** 玩家在伤害契约中的保留实体 ID；0 为无效/调试来源，玩家恒为 1。 */
const PLAYER_ENTITY_ID = 1;
/** 接触检测节奏（战斗秒）：受控频率全场扫描，不逐帧检测。 */
const CONTACT_CHECK_INTERVAL = 0.1;

/**
 * 玩家生命组件（挂在 Player 节点）：持有 PlayerVitals 运行态，按受控节奏
 * 对注册表做接触检测，与存活怪物的圆形重叠（碰撞半径和）触发一次接触伤害
 * （数值来自怪物配置 contactDamage）；受击后进入配置化无敌帧；死亡发布
 * playerDied 并把战局转 Ended（模拟整体冻结）。
 */
@ccclass('PlayerAgent')
export class PlayerAgent extends Component {
  @property({ type: BattleController })
  private battleController: BattleController | null = null;

  private registry: TargetRegistry | null = null;
  private vitals: PlayerVitals | null = null;
  private combatStats: PlayerCombatStats | null = null;
  private treasureRuntime: TreasureRuntime | null = null;
  private loadout: BattleLoadoutSnapshot = EMPTY_BATTLE_LOADOUT;
  private unsubscribeDied: (() => void) | null = null;
  private contactTimer = 0;

  /**
   * 死亡拦截门（V10-10 广告复活，注入式可选；null = 原行为立即死亡结束）。
   * 复活路径不发布 playerDied 事实、战局不转 Ended（复活由门控方恢复生命与
   * 无敌帧并继续战斗）；接受死亡路径与原行为完全一致（发布 + endBattle）。
   */
  public deathReviveGate: ((context: DeathReviveContext) => void) | null = null;

  protected override start(): void {
    if (this.battleController === null) {
      throw new Error('[PlayerAgent] missing reference: battleController ← 把 Systems 节点拖入该属性槽');
    }
    // 正式美术（V10-14）：玩家切图；缺图回退灰盒。
    applyArtSprite(this.node, 'entity_player');
    const registryComponent = this.battleController.getComponent(TargetRegistryComponent);
    if (registryComponent === null) {
      throw new Error('[PlayerAgent] Systems 节点缺少 TargetRegistryComponent 组件');
    }
    this.registry = registryComponent.registry;
    const progression = this.battleController.getComponent(ProgressionSystem);
    if (progression === null) {
      throw new Error('[PlayerAgent] Systems 节点缺少 ProgressionSystem 组件');
    }
    if (progression.stats === null) {
      throw new Error('[PlayerAgent] ProgressionSystem 尚未初始化战斗运行态');
    }
    this.combatStats = progression.stats;
    this.treasureRuntime = progression.treasure;
    this.loadout = progression.loadout;

    const playerConfig = INITIAL_GAME_CONFIG.player;
    this.vitals = new PlayerVitals(
      {
        maxHp: playerConfig.maxHp + this.loadout.maxHpBonus,
        invulnerableSeconds: playerConfig.invulnerableSeconds,
      },
      {
        markPlayerDead: (): void => {
          // 死亡标记仅置位；实际停机由 endBattle 转 Ended（battleDelta 归零）统一保证。
        },
        publishPlayerDied: (payload): void => {
          if (this.battleController === null) {
            return;
          }
          if (this.deathReviveGate !== null) {
            this.deathReviveGate({
              revive: (hpAmount, invulnerableSeconds): void => {
                this.vitals?.reviveWith(hpAmount, invulnerableSeconds);
              },
              acceptDeath: (): void => {
                if (this.battleController === null) {
                  return;
                }
                this.battleController.events.emit('playerDied', payload);
                if (
                  this.battleController.state === 'running' ||
                  this.battleController.state === 'level_up_paused'
                ) {
                  this.battleController.endBattle();
                }
              },
            });
            return;
          }
          this.battleController.events.emit('playerDied', payload);
          if (
            this.battleController.state === 'running' ||
            this.battleController.state === 'level_up_paused'
          ) {
            this.battleController.endBattle();
          }
        },
      },
    );
  }

  protected override onEnable(): void {
    if (this.battleController === null) {
      return;
    }
    this.unsubscribeDied = this.battleController.events.on('monsterDied', (payload) => {
      this.handleMonsterKilledHeal(payload.entityId);
    });
  }

  protected override onDisable(): void {
    this.unsubscribeDied?.();
    this.unsubscribeDied = null;
  }

  /** 噬妖幡触发：击杀即回血；未获得法宝（0）时静默跳过。 */
  private handleMonsterKilledHeal(_killerEntityId: number): void {
    if (this.vitals === null || this.treasureRuntime === null) {
      return;
    }
    const healAmount = this.treasureRuntime.healOnKillAmount;
    if (healAmount <= 0 || this.vitals.isDead) {
      return;
    }
    const healed = this.vitals.heal(healAmount);
    if (healed > 0) {
      this.battleController?.events.emit('playerHpChanged', {
        hp: this.vitals.currentHp,
        maxHp: this.vitals.maxHp,
        cause: 'heal',
      });
      console.log(`[PlayerAgent] heal +${healed} on kill, hp=${this.vitals.currentHp}/${this.vitals.maxHp}`);
    }
  }

  protected override update(): void {
    if (this.battleController === null || this.registry === null || this.vitals === null) {
      return;
    }
    const deltaTime = this.battleController.battleDeltaTime;
    if (deltaTime <= 0 || this.vitals.isDead) {
      return;
    }

    this.vitals.advance(deltaTime);

    this.contactTimer += deltaTime;
    if (this.contactTimer < CONTACT_CHECK_INTERVAL) {
      return;
    }
    this.contactTimer -= CONTACT_CHECK_INTERVAL;

    this.registry.forEachTarget(this.checkContact);
  }

  private readonly checkContact = (target: unknown, entityId: number): void => {
    if (this.vitals === null || this.vitals.isDead || !(target instanceof MonsterAgent) || entityId === 0) {
      return;
    }
    const contactRange = INITIAL_GAME_CONFIG.player.collisionRadius;
    const hitRange = contactRange + target.collisionRadius;
    const playerPosition = this.node.position;
    const position = { x: 0, y: 0 };
    target.readPosition(position);
    const deltaX = position.x - playerPosition.x;
    const deltaY = position.y - playerPosition.y;
    if (deltaX * deltaX + deltaY * deltaY > hitRange * hitRange) {
      return;
    }

    // 接触伤害来自怪物的有效数值快照（含精英强化）。
    const rawContactDamage = target.contactDamage;
    if (rawContactDamage > 0) {
      this.applyExternalDamage(rawContactDamage, entityId, target.isElite ? ' [elite]' : '');
    }
  };

  /**
   * 外部伤害统一入口（怪物接触、Boss 弹幕）：先过运行态减免再进伤害契约；
   * 返回是否实际结算。无敌帧/死亡拒绝由 PlayerVitals 保证。
   */
  public applyExternalDamage(rawAmount: number, sourceEntityId: number, tag = ''): boolean {
    if (this.vitals === null) {
      return false;
    }
    const contactDamage = this.combatStats?.reduceContactDamage(rawAmount) ?? rawAmount;
    const request: DamageRequest = {
      sourceEntityId,
      targetEntityId: PLAYER_ENTITY_ID,
      amount: contactDamage,
      damageType: 'contact',
    };
    const result: DamageResult = this.vitals.takeContactDamage(request, PLAYER_ENTITY_ID, {
      x: this.node.position.x,
      y: this.node.position.y,
    });
    if (result.status === 'applied') {
      this.battleController?.events.emit('playerHpChanged', {
        hp: this.vitals.currentHp,
        maxHp: this.vitals.maxHp,
        cause: 'damage',
      });
      console.log(
        `[PlayerAgent] contact damage ${contactDamage} (raw ${rawAmount}) from entityId=${sourceEntityId}${tag}, ` +
          `hp=${this.vitals.currentHp}/${this.vitals.maxHp}`,
      );
    }
    return result.status === 'applied';
  }

  public get currentHp(): number {
    return this.vitals?.currentHp ?? INITIAL_GAME_CONFIG.player.maxHp;
  }

  public get maxHp(): number {
    return this.vitals?.maxHp ?? INITIAL_GAME_CONFIG.player.maxHp + this.loadout.maxHpBonus;
  }

  /** 出战灵兽治疗入口（V05-08 玄武等 heal 技能）：复用 PlayerVitals 双向夹紧，满血返回 0。 */
  public applyCompanionHeal(amount: number): number {
    if (this.vitals === null || this.vitals.isDead || !(amount > 0)) {
      return 0;
    }
    const healed = this.vitals.heal(amount);
    if (healed > 0) {
      this.battleController?.events.emit('playerHpChanged', {
        hp: this.vitals.currentHp,
        maxHp: this.vitals.maxHp,
        cause: 'heal',
      });
      console.log(`[PlayerAgent] companion heal +${healed}, hp=${this.vitals.currentHp}/${this.vitals.maxHp}`);
    }
    return healed;
  }

  public get isDead(): boolean {
    return this.vitals?.isDead ?? false;
  }
}

export interface DeathReviveContext {
  /** 发奖成功后调用：恢复指定生命并进入无敌秒数，战斗继续（不发布死亡事实）。 */
  readonly revive: (hpAmount: number, invulnerableSeconds: number) => void;
  /** 放弃复活/不可提供时调用：与原死亡行为一致（发布 playerDied + 结束战局）。 */
  readonly acceptDeath: () => void;
}
