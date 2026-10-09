/**
 * 中央红点服务（V08-16）：红点只挂"可领取/可执行"（RETENTION.md 原则）。
 *
 * - 数据源 = 各系统可领取查询（MainNav 注册：任务/成就/累计登录/奖励中心）；
 *   页面聚合不递归（奖励中心红点 = 四源 OR 的独立注册，不读其他红点）。
 * - 事件驱动刷新：面板打开/关闭、领取操作（onOperationDone）、场景返回
 *   （MainNav.onEnable）时调用 refresh() 全量重算并通知订阅者——**无每帧扫描**。
 * - 打开页面不自动清除红点：清除只由领取事务驱动的状态变化产生（重算后自然熄灭）。
 * - UI 层单例（模块级实例）；订阅在 onEnable/onDisable 成对解除。
 */

export type RedDotProvider = () => boolean;
export type RedDotListener = () => void;

export class RedDotService {
  private readonly providers = new Map<string, RedDotProvider>();
  private readonly states = new Map<string, boolean>();
  private readonly listeners = new Set<RedDotListener>();

  /** 注册红点数据源（重复注册覆盖；refresh 前不生效）。 */
  public registerSource(dotId: string, provider: RedDotProvider): void {
    this.providers.set(dotId, provider);
  }

  /** 全量重算并通知订阅者（低频调用：面板开/关、领取后、场景返回）。 */
  public refresh(): void {
    for (const [dotId, provider] of this.providers) {
      let lit = false;
      try {
        lit = provider();
      } catch (error) {
        // 数据源异常按熄灭处理（不阻塞其他红点），开发期在控制台留痕。
        console.warn(`[RedDotService] provider "${dotId}" failed: ${String(error)}`);
        lit = false;
      }
      this.states.set(dotId, lit);
    }
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** 红点当前是否点亮（未注册/未刷新为 false）。 */
  public isLit(dotId: string): boolean {
    return this.states.get(dotId) ?? false;
  }

  /** 订阅红点变化；返回解除订阅函数（onEnable/onDisable 成对）。 */
  public onChange(listener: RedDotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** UI 层红点单例（场景内组件经此访问；账号服务仍经 AccountSystem.instance）。 */
export const redDotService = new RedDotService();
