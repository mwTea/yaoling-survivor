/**
 * 纯 TS 冷却计时：武器发射冷却与无目标重试共用。
 * 由战斗 delta 驱动（暂停时 delta 为 0，计时自然冻结）。
 */
/** 浮点残差阈值：0.8 - 0.79 - 0.01 这类累计误差不应让计时器卡在"差 1e-17 秒"。 */
const EPSILON_SECONDS = 1e-9;

export class CooldownTimer {
  private durationSeconds: number;
  private remainingSeconds: number;

  constructor(durationSeconds: number) {
    if (!(durationSeconds > 0) || !Number.isFinite(durationSeconds)) {
      throw new Error(`CooldownTimer duration must be a positive finite number, got ${durationSeconds}`);
    }
    this.durationSeconds = durationSeconds;
    this.remainingSeconds = 0;
  }

  public get isReady(): boolean {
    return this.remainingSeconds <= 0;
  }

  /** 当前冷却时长（触发时使用）；升级降低冷却时在下一次触发生效。 */
  public get duration(): number {
    return this.durationSeconds;
  }

  public setDuration(durationSeconds: number): void {
    if (!(durationSeconds > 0) || !Number.isFinite(durationSeconds)) {
      throw new Error(`CooldownTimer duration must be a positive finite number, got ${durationSeconds}`);
    }
    this.durationSeconds = durationSeconds;
  }

  public advance(deltaTime: number): void {
    if (deltaTime <= 0) {
      return;
    }
    const next = this.remainingSeconds - deltaTime;
    this.remainingSeconds = next <= EPSILON_SECONDS ? 0 : next;
  }

  /** 触发一次冷却（或重试等待），重新计时整个时长。 */
  public trigger(): void {
    this.remainingSeconds = this.durationSeconds;
  }
}
