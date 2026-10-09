/**
 * 账号存档 schema v3 与存取（V05-01 建立 v1；V08-01 扩展为 v2；V10-01 扩展为 v3）。
 *
 * 单文件叶子模块（同 Pools.ts / Combat.ts 先例）：零跨文件值导入，
 * 可被 `game/tests/*.test.mjs` 直接以 node --experimental-strip-types 加载。
 *
 * 边界（CONFIG.md 总则）：配置定义"规则与内容"，本文件只承载"玩家状态"，
 * 两者禁止混写。字段显式命名（playerLevel / weaponLevels / beasts[].level 等），
 * 四条成长线不共用含糊的 level 字段（PROGRESSION.md）。
 *
 * v2 设计（CODEX_TASKS_V08 阶段决策 1）：进度域扩展（关卡记录/章节解锁/选中关卡）
 * 与留存域（任务周期桶/成就/累计登录/商店/图鉴/礼包与奖励中心条目/活动实例）
 * 一次性定义容器与最小字段，语义由后续任务赋予；后续任务只填语义不改结构。
 *
 * v3 设计（CODEX_TASKS_V10 阶段决策 4）：一次性新增身份域（本地访客/微信 openid
 * 占位/账号创建与最后登录时间）、设置域（音量/震动/画质/协议版本）、引导域
 * （脚本版本/已完成步骤）、云同步元数据（上次同步时间与来源）四个容器与最小字段，
 * 语义由 V10-03/05/06/07/09 赋予；v1→v2→v3 迁移补默认值无损且幂等。
 */
import type { StorageAdapter } from '../platform/StorageAdapter';

export const ACCOUNT_SAVE_SCHEMA_VERSION = 3;
/** 上一代 schema 版本；仅用于 v1→v2 自动迁移判定，不再新建。 */
export const ACCOUNT_SAVE_SCHEMA_VERSION_V1 = 1;
/** v2 版本号；仅用于 v2→v3 自动迁移判定，不再新建。 */
export const ACCOUNT_SAVE_SCHEMA_VERSION_V2 = 2;
export const ACCOUNT_SAVE_STORAGE_KEY = 'yaoling_account_save';
export const CORRUPT_SAVE_BACKUP_SUFFIX = '_corrupt_backup';
export const MAX_RECENT_TRANSACTIONS = 20;

/** 主线任务永久周期桶的固定 periodKey（每日/每周桶的 periodKey 为 TimeService 的 dayKey/weekKey）。 */
export const TASK_MAIN_PERIOD_KEY = 'main';

/** 关卡记录复合键：`${stageId}|${difficultyId}`；ID 均为 snake_case，分隔符不会出现在 ID 内。 */
export const STAGE_RECORD_KEY_SEPARATOR = '|';

export function buildStageRecordKey(stageId: string, difficultyId: string): string {
  return `${stageId}${STAGE_RECORD_KEY_SEPARATOR}${difficultyId}`;
}

/** 关键事务审计条目（环形保留最近 MAX_RECENT_TRANSACTIONS 条，新事务追加在尾部）。 */
export interface AccountTxEntry {
  readonly txId: string;
  readonly kind: string;
  /** 变化摘要：资源/属性 ID 到整数增量（正增负减）。 */
  readonly deltas: Record<string, number>;
  /** 事务时间（epoch 毫秒）。 */
  readonly at: number;
}

/** 灵兽培养存档条目；出战状态单独存 deployedBeastId，不混入本条目。 */
export interface BeastSaveEntry {
  unlocked: boolean;
  level: number;
  star: number;
}

/**
 * 关卡记录条目（v2 新增容器，语义由 V08-03～V08-05 赋予）：
 * 键为 buildStageRecordKey(stageId, difficultyId)。
 */
export interface StageRecordEntry {
  /** 历史最高星级（0～3，只进不退；0 = 该难度未通关）。 */
  highestStars: number;
  /** 是否已通关过。 */
  cleared: boolean;
  /** 首通奖励是否已领取。 */
  firstClearClaimed: boolean;
  /** 已领取的星级累计奖励档数。 */
  claimedStarRewardTiers: number;
}

/** 关卡选中状态（V08-03 赋语义：跨场景的开战默认目标）；null = 未选择。 */
export interface StageSelectionSave {
  stageId: string;
  difficultyId: string;
}

/** 任务周期桶（V08-08 赋语义）：进度由领域事件累计，periodKey 变化即整桶重置。 */
export interface TaskPeriodBucketSave {
  /** 主线桶恒为 'main'；每日/每周桶为 dayKey/weekKey。 */
  periodKey: string;
  /** taskId → 周期内累计进度（非负整数）。 */
  progress: Record<string, number>;
  /** 周期内已领取奖励的任务 ID。 */
  claimedTaskIds: string[];
}

export interface TaskBucketsSave {
  main: TaskPeriodBucketSave;
  daily: TaskPeriodBucketSave;
  weekly: TaskPeriodBucketSave;
}

/** 成就进度与领取（V08-10 赋语义）：分级阶段共用累计进度，只进不退。 */
export interface AchievementSaveEntry {
  /** 跨阶段累计进度。 */
  progress: number;
  /** 已领取的最高阶段档位（0 = 未领取任何档）。 */
  claimedTier: number;
}

/** 30 日累计登录状态（V08-14 赋语义；不补签，每自然日最多 +1）。 */
export interface LoginRewardSaveState {
  /** 累计有效登录天数。 */
  totalDays: number;
  /** 最近一次计数的自然日 key（yyyy-MM-dd）；空串 = 从未计数。 */
  lastCountedDayKey: string;
  /** 本轮已领取的最高奖励档位（0 = 未领取；第 30 档领完即完结）。 */
  claimedTier: number;
}

/** 商店购买状态（V08-12 赋语义）。 */
export interface ShopSaveState {
  /** 当前限购周期 key（dayKey）；与当前 dayKey 不同即视为每日限购已刷新。 */
  refreshDayKey: string;
  /** 商品配置 ID → 本周期内已购次数。 */
  purchaseCounts: Record<string, number>;
}

/** 图鉴状态（V08-11 赋语义）：三态条目 = 未见到 seenIds 到 defeatedIds。 */
export interface CodexSaveState {
  /** 已遭遇（见过）的怪物/Boss 配置 ID。 */
  seenIds: string[];
  /** 已击败的怪物/Boss 配置 ID。 */
  defeatedIds: string[];
}

/**
 * 统一礼包（奖励中心条目）领取记录（V08-15 赋语义）；key 为 offer 配置 ID。
 * 奖励中心为聚合视图，不设独立领取真相：任务/成就/登录领取态在各自域，
 * 礼包条目领取态在本容器（阶段决策 6：不建邮件/补发队列）。
 */
export interface OfferClaimSaveEntry {
  /** 已领取次数（限购判据；免费礼包通常为 1）。 */
  claimCount: number;
}

/** 活动实例状态（V08-16 赋语义）；key 为活动配置 ID。 */
export interface ActivitySaveEntry {
  /** 实例状态标记（如 open / closed / closed_unclaimed_handled）。 */
  status: string;
}

/**
 * 设置域默认值（V10-06 单一真相）：新建存档、迁移修复与"恢复默认"同源。
 * 数值默认安全档：满音量、震动开、画质自动（0）、协议版本未确认（0）。
 */
export const DEFAULT_ACCOUNT_SETTINGS: Readonly<SettingsSaveState> = Object.freeze({
  bgmVolume: 100,
  sfxVolume: 100,
  vibrationEnabled: true,
  qualityTier: 0,
  agreementVersion: 0,
});

/**
 * 身份域（v3 新增，V10-07 登录任务赋语义）：本地与平台身份标识及登录时间戳。
 * 空串占位表示"尚未生成/未登录"，由登录任务写入；不在此处做任何 ID 生成。
 */
export interface IdentitySaveState {
  /** 本地访客标识（首启生成后不变；空串 = 未生成）。 */
  localGuestId: string;
  /** 微信 openid（登录成功后写入；空串 = 未登录/访客态）。 */
  wxOpenId: string;
  /** 账号创建时间戳（epoch 毫秒；0 = 未知，与顶层 createdAt 同源冗余承载身份语义）。 */
  accountCreatedAt: number;
  /** 最后登录时间戳（epoch 毫秒；0 = 从未记录）。 */
  lastLoginAt: number;
}

/**
 * 设置域（v3 新增，V10-05/V10-06 赋语义）：用户偏好，默认值取"标准可玩"安全档。
 * 设置变化写入本域后由装配层实时应用到 AudioService 等服务。
 */
export interface SettingsSaveState {
  /** BGM 音量 0～100（默认 100）。 */
  bgmVolume: number;
  /** 音效音量 0～100（默认 100）。 */
  sfxVolume: number;
  /** 震动开关（默认开启）。 */
  vibrationEnabled: boolean;
  /** 画质档位 0～2（0 = 自动，语义由 V10-06 定义；默认 0）。 */
  qualityTier: number;
  /** 已确认的协议/隐私指引版本号（0 = 未确认；V10-16 合规流赋语义）。 */
  agreementVersion: number;
}

/**
 * 引导域（v3 新增，V10-03/V10-04 赋语义）：新手引导完成状态。
 * 脚本版本号用于改版迁移：版本升级后老玩家不重卡引导（V10-03 定案）。
 */
export interface GuideSaveState {
  /** 已完成/进行中的引导脚本版本号（0 = 无引导记录）。 */
  scriptVersion: number;
  /** 当前脚本版本下已完成步骤的配置 ID 列表（按完成顺序）。 */
  completedStepIds: string[];
}

/**
 * 云同步元数据（v3 新增，V10-09 云存档任务赋语义）：本地容错用，
 * 记录最近一次云同步结果；真实云端真相在云数据库文档，不在本域。
 */
export interface CloudSyncSaveMeta {
  /** 上次云同步成功时间戳（epoch 毫秒；0 = 从未同步）。 */
  lastSyncedAt: number;
  /** 上次同步来源标记（如 upload / download；空串 = 从未同步）。 */
  lastSyncSource: string;
}

/**
 * 账号存档（schemaVersion 3）。域划分沿用 ARCHITECTURE.md：
 * 进度（玩家等级经验、境界、关卡记录、章节解锁、选中关卡）/ 养成（法器、灵兽）/
 * 库存 / 留存（任务、成就、登录、商店、图鉴、礼包、活动）/ 身份 / 设置 / 引导 /
 * 审计 + 元信息（含云同步元数据）。
 */
export interface AccountSaveData {
  schemaVersion: number;
  createdAt: number;
  lastSavedAt: number;
  /** 进度域：账号玩家等级（与局内战斗等级完全无关，只作培养上限/解锁门槛）。 */
  playerLevel: number;
  /** 进度域：账号经验（只用于玩家等级，不是支付货币，不入库存）。 */
  playerXp: number;
  /** 进度域：大境界下标（语义由 RealmConfig 定义，V05-04 接入）。 */
  realmIndex: number;
  /** 进度域：当前大境界内的有序小境界下标。 */
  subRealmIndex: number;
  /** 进度域（v2）：关卡记录，键为 buildStageRecordKey(stageId, difficultyId)。 */
  stageRecords: Record<string, StageRecordEntry>;
  /** 进度域（v2）：已解锁章节配置 ID（解锁链语义由 V08-03 赋予）。 */
  unlockedChapterIds: string[];
  /** 进度域（v2）：选中关卡；null = 未选择（V08-03 默认第一关）。 */
  stageSelection: StageSelectionSave | null;
  /** 养成域：法器等级，key 为法器配置 ID。 */
  weaponLevels: Record<string, number>;
  /** 养成域：灵兽状态，key 为灵兽配置 ID。 */
  beasts: Record<string, BeastSaveEntry>;
  /** 养成域：当前出战灵兽配置 ID；null 表示未出战。 */
  deployedBeastId: string | null;
  /** 库存域：资源余额，key 为资源配置 ID（res_lingshi 等），整数最小单位。 */
  balances: Record<string, number>;
  /** 留存域（v2）：任务进度周期桶。 */
  taskBuckets: TaskBucketsSave;
  /** 留存域（v2）：成就进度与领取，key 为成就配置 ID。 */
  achievements: Record<string, AchievementSaveEntry>;
  /** 留存域（v2）：30 日累计登录状态。 */
  loginReward: LoginRewardSaveState;
  /** 留存域（v2）：商店购买状态。 */
  shop: ShopSaveState;
  /** 留存域（v2）：图鉴状态。 */
  codex: CodexSaveState;
  /** 留存域（v2）：统一礼包（奖励中心条目）领取记录，key 为 offer 配置 ID。 */
  offerClaims: Record<string, OfferClaimSaveEntry>;
  /** 留存域（v2）：活动实例状态，key 为活动配置 ID。 */
  activities: Record<string, ActivitySaveEntry>;
  /** 身份域（v3）：本地/平台身份与登录时间戳。 */
  identity: IdentitySaveState;
  /** 设置域（v3）：用户偏好（音量/震动/画质/协议版本）。 */
  settings: SettingsSaveState;
  /** 引导域（v3）：新手引导完成状态。 */
  guide: GuideSaveState;
  /** 云同步元数据（v3）：上次云同步时间与来源（本地容错用）。 */
  cloudSync: CloudSyncSaveMeta;
  /** 审计域：最近关键事务。 */
  recentTransactions: AccountTxEntry[];
}

export type ParseAccountSaveFailReason =
  | 'empty_payload'
  | 'invalid_json'
  | 'not_an_object'
  | 'unsupported_save_version';

export type ParseAccountSaveResult =
  | { readonly ok: true; readonly data: AccountSaveData }
  | { readonly ok: false; readonly reason: ParseAccountSaveFailReason };

export function createEmptyAccountSave(now: number): AccountSaveData {
  return {
    schemaVersion: ACCOUNT_SAVE_SCHEMA_VERSION,
    createdAt: now,
    lastSavedAt: now,
    playerLevel: 1,
    playerXp: 0,
    realmIndex: 0,
    subRealmIndex: 0,
    stageRecords: {},
    unlockedChapterIds: [],
    stageSelection: null,
    weaponLevels: {},
    beasts: {},
    deployedBeastId: null,
    balances: {},
    taskBuckets: {
      main: { periodKey: TASK_MAIN_PERIOD_KEY, progress: {}, claimedTaskIds: [] },
      daily: { periodKey: '', progress: {}, claimedTaskIds: [] },
      weekly: { periodKey: '', progress: {}, claimedTaskIds: [] },
    },
    achievements: {},
    loginReward: { totalDays: 0, lastCountedDayKey: '', claimedTier: 0 },
    shop: { refreshDayKey: '', purchaseCounts: {} },
    codex: { seenIds: [], defeatedIds: [] },
    offerClaims: {},
    activities: {},
    identity: { localGuestId: '', wxOpenId: '', accountCreatedAt: now, lastLoginAt: 0 },
    settings: { ...DEFAULT_ACCOUNT_SETTINGS },
    guide: { scriptVersion: 0, completedStepIds: [] },
    cloudSync: { lastSyncedAt: 0, lastSyncSource: '' },
    recentTransactions: [],
  };
}

/**
 * 解析原始存档字符串。类型错位/缺字段按安全默认值修复（不抛错）；
 * v1/v2 存档自动迁移为当前 schema（补默认值，原字段无损保留）；仅 JSON 非法、
 * 结构非对象、未知 schemaVersion 返回失败原因。
 */
export function parseAccountSave(raw: string): ParseAccountSaveResult {
  if (raw.length === 0) {
    return { ok: false, reason: 'empty_payload' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'not_an_object' };
  }
  const rawRecord = parsed as Record<string, unknown>;
  if (
    rawRecord.schemaVersion !== ACCOUNT_SAVE_SCHEMA_VERSION &&
    rawRecord.schemaVersion !== ACCOUNT_SAVE_SCHEMA_VERSION_V2 &&
    rawRecord.schemaVersion !== ACCOUNT_SAVE_SCHEMA_VERSION_V1
  ) {
    return { ok: false, reason: 'unsupported_save_version' };
  }
  return { ok: true, data: upgradeAccountSaveV2ToV3(rawRecord) };
}

/**
 * 将未知结构修复为合法存档状态；只保证形状安全，语义校验由领域模块负责。
 * 输出恒为当前 schemaVersion；v1/v2/v3 形状输入都按同一规则归一
 * （旧版缺失的域落默认值）。
 */
export function normalizeAccountSave(raw: Record<string, unknown>): AccountSaveData {
  return {
    schemaVersion: ACCOUNT_SAVE_SCHEMA_VERSION,
    createdAt: sanitizeInt(raw.createdAt, 0, 0),
    lastSavedAt: sanitizeInt(raw.lastSavedAt, 0, 0),
    playerLevel: sanitizeInt(raw.playerLevel, 1, 1),
    playerXp: sanitizeInt(raw.playerXp, 0, 0),
    realmIndex: sanitizeInt(raw.realmIndex, 0, 0),
    subRealmIndex: sanitizeInt(raw.subRealmIndex, 0, 0),
    stageRecords: sanitizeStageRecords(raw.stageRecords),
    unlockedChapterIds: sanitizeStringList(raw.unlockedChapterIds),
    stageSelection: sanitizeStageSelection(raw.stageSelection),
    weaponLevels: sanitizeWeaponLevels(raw.weaponLevels),
    beasts: sanitizeBeasts(raw.beasts),
    deployedBeastId: sanitizeStringId(raw.deployedBeastId),
    balances: sanitizeBalanceMap(raw.balances),
    taskBuckets: sanitizeTaskBuckets(raw.taskBuckets),
    achievements: sanitizeAchievements(raw.achievements),
    loginReward: sanitizeLoginReward(raw.loginReward),
    shop: sanitizeShopState(raw.shop),
    codex: sanitizeCodexState(raw.codex),
    offerClaims: sanitizeOfferClaims(raw.offerClaims),
    activities: sanitizeActivities(raw.activities),
    identity: sanitizeIdentity(raw.identity),
    settings: sanitizeSettings(raw.settings),
    guide: sanitizeGuide(raw.guide),
    cloudSync: sanitizeCloudSync(raw.cloudSync),
    recentTransactions: sanitizeTransactions(raw.recentTransactions),
  };
}

/**
 * v1→v2 迁移入口（V08-01）。V10-01 起 v2 又扩展为 v3，v1/v2→当前版本
 * 统一走同一 normalize 归一路径（补默认值、无损、幂等），输出恒为当前
 * schemaVersion；保留本入口仅为历史兼容命名。
 */
export function upgradeAccountSaveV1ToV2(raw: Record<string, unknown>): AccountSaveData {
  return normalizeAccountSave(raw);
}

/**
 * v2→v3 迁移入口（V10-01）：v2 全字段无损保留，身份/设置/引导/云同步域补默认值。
 * 幂等：v3 数据（或本函数输出）再次输入，输出不变。
 */
export function upgradeAccountSaveV2ToV3(raw: Record<string, unknown>): AccountSaveData {
  return normalizeAccountSave(raw);
}

export function serializeAccountSave(data: AccountSaveData): string {
  return JSON.stringify(data);
}

/**
 * 账号存取服务：注入存储适配器，负责缓存、时间戳与损坏兜底。
 * 调用方通过领域模块修改 load() 返回的工作状态并调用 save() 提交；
 * 不得绕过事务直接改写字段后不落盘。v1/v2 旧档在 load() 时自动迁移为当前
 * schema（迁移确定性幂等，无需落盘迁移结果；下次 save 自然写入当前版本）。
 */
export class AccountStore {
  private readonly storage: StorageAdapter;
  private readonly now: () => number;
  private cached: AccountSaveData | null = null;
  private resetReason: ParseAccountSaveFailReason | 'no_existing_save' | null = null;

  constructor(storage: StorageAdapter, now: () => number = () => Date.now()) {
    this.storage = storage;
    this.now = now;
  }

  /** 最近一次 load() 触发重置的原因；正常载入已有存档（含 v1 自动迁移）为 null。供装配层诊断输出。 */
  get lastResetReason(): ParseAccountSaveFailReason | 'no_existing_save' | null {
    return this.resetReason;
  }

  /** 是否已有历史存档文件（不触发加载）。 */
  hasSave(): boolean {
    return this.storage.getString(ACCOUNT_SAVE_STORAGE_KEY) !== null;
  }

  /**
   * 载入账号状态；无档/损坏/未知版本时备份原始数据并立即落盘新档。
   * 损坏备份 key 为 ACCOUNT_SAVE_STORAGE_KEY + CORRUPT_SAVE_BACKUP_SUFFIX。
   */
  load(): AccountSaveData {
    if (this.cached !== null) {
      return this.cached;
    }
    this.resetReason = null;
    const raw = this.storage.getString(ACCOUNT_SAVE_STORAGE_KEY);
    if (raw === null) {
      return this.resetToFresh('no_existing_save');
    }
    const parsed = parseAccountSave(raw);
    if (!parsed.ok) {
      this.storage.setString(ACCOUNT_SAVE_STORAGE_KEY + CORRUPT_SAVE_BACKUP_SUFFIX, raw);
      return this.resetToFresh(parsed.reason);
    }
    this.cached = parsed.data;
    return this.cached;
  }

  /** 提交状态变更：盖 lastSavedAt 时间戳、更新缓存并写回存储。 */
  save(data: AccountSaveData): void {
    const stamped: AccountSaveData = { ...data, lastSavedAt: this.now() };
    this.cached = stamped;
    this.storage.setString(ACCOUNT_SAVE_STORAGE_KEY, serializeAccountSave(stamped));
  }

  /**
   * 显式清档（V08-06 我的页调试入口，二次确认由 UI 负责）：丢弃当前工作状态，
   * 立即落盘全新存档（与"无档开新档"同一重置路径，不备份旧档）。
   */
  resetToNewSave(): AccountSaveData {
    this.resetReason = null;
    const fresh = createEmptyAccountSave(this.now());
    this.save(fresh);
    return fresh;
  }

  private resetToFresh(reason: ParseAccountSaveFailReason | 'no_existing_save'): AccountSaveData {
    this.resetReason = reason;
    const fresh = createEmptyAccountSave(this.now());
    this.save(fresh);
    return fresh;
  }
}

function sanitizeInt(value: unknown, fallback: number, min: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const floored = Math.floor(value);
    return floored >= min ? floored : fallback;
  }
  return fallback;
}

function sanitizeNonNegativeInt(value: unknown): number {
  return sanitizeInt(value, 0, 0);
}

function sanitizeStringId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 非空字符串列表：过滤非法项并按首次出现去重（保持顺序）。 */
function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0 && result.indexOf(item) === -1) {
      result.push(item);
    }
  }
  return result;
}

function sanitizeRecord(value: unknown): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return entries;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key.length > 0) {
      entries.push([key, record[key]]);
    }
  }
  return entries;
}

function sanitizeBalanceMap(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, raw] of sanitizeRecord(value)) {
    const amount = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0;
    // 负余额是经济事务层的违规态，此处防御性钳为 0（修复语义，见任务记录）。
    result[key] = Math.max(0, amount);
  }
  return result;
}

/** 计数/进度类映射：非负整数，负值与非法值修复为 0。 */
function sanitizeCountMap(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, raw] of sanitizeRecord(value)) {
    result[key] = sanitizeNonNegativeInt(raw);
  }
  return result;
}

/** 事务 deltas 是变化量，负数（消耗）合法，只做整数修复不做钳制。 */
function sanitizeDeltaMap(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, raw] of sanitizeRecord(value)) {
    const amount = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0;
    result[key] = amount;
  }
  return result;
}

function sanitizeWeaponLevels(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, raw] of sanitizeRecord(value)) {
    result[key] = sanitizeInt(raw, 1, 1);
  }
  return result;
}

function sanitizeBeasts(value: unknown): Record<string, BeastSaveEntry> {
  const result: Record<string, BeastSaveEntry> = {};
  for (const [key, raw] of sanitizeRecord(value)) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    result[key] = {
      unlocked: entry.unlocked === true,
      level: sanitizeInt(entry.level, 1, 1),
      star: sanitizeInt(entry.star, 0, 0),
    };
  }
  return result;
}

function sanitizeTransactions(value: unknown): AccountTxEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: AccountTxEntry[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const txId = sanitizeStringId(entry.txId);
    const kind = sanitizeStringId(entry.kind);
    if (txId === null || kind === null) {
      continue;
    }
    result.push({
      txId,
      kind,
      deltas: sanitizeDeltaMap(entry.deltas),
      at: sanitizeInt(entry.at, 0, 0),
    });
  }
  return result.length > MAX_RECENT_TRANSACTIONS
    ? result.slice(result.length - MAX_RECENT_TRANSACTIONS)
    : result;
}

/** 星级钳制到 0～3（三星定案：第一星恒为通关）。 */
function sanitizeStarCount(value: unknown): number {
  return Math.min(3, sanitizeNonNegativeInt(value));
}

function sanitizeStageRecords(value: unknown): Record<string, StageRecordEntry> {
  const result: Record<string, StageRecordEntry> = {};
  for (const [key, raw] of sanitizeRecord(value)) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    result[key] = {
      highestStars: sanitizeStarCount(entry.highestStars),
      cleared: entry.cleared === true,
      firstClearClaimed: entry.firstClearClaimed === true,
      claimedStarRewardTiers: sanitizeNonNegativeInt(entry.claimedStarRewardTiers),
    };
  }
  return result;
}

function sanitizeStageSelection(value: unknown): StageSelectionSave | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const stageId = sanitizeStringId(raw.stageId);
  const difficultyId = sanitizeStringId(raw.difficultyId);
  if (stageId === null || difficultyId === null) {
    return null;
  }
  return { stageId, difficultyId };
}

function sanitizeTaskBucket(value: unknown, defaultPeriodKey: string): TaskPeriodBucketSave {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { periodKey: defaultPeriodKey, progress: {}, claimedTaskIds: [] };
  }
  const raw = value as Record<string, unknown>;
  return {
    periodKey: sanitizeString(raw.periodKey) || defaultPeriodKey,
    progress: sanitizeCountMap(raw.progress),
    claimedTaskIds: sanitizeStringList(raw.claimedTaskIds),
  };
}

function sanitizeTaskBuckets(value: unknown): TaskBucketsSave {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      main: sanitizeTaskBucket(undefined, TASK_MAIN_PERIOD_KEY),
      daily: sanitizeTaskBucket(undefined, ''),
      weekly: sanitizeTaskBucket(undefined, ''),
    };
  }
  const raw = value as Record<string, unknown>;
  return {
    main: sanitizeTaskBucket(raw.main, TASK_MAIN_PERIOD_KEY),
    daily: sanitizeTaskBucket(raw.daily, ''),
    weekly: sanitizeTaskBucket(raw.weekly, ''),
  };
}

function sanitizeAchievements(value: unknown): Record<string, AchievementSaveEntry> {
  const result: Record<string, AchievementSaveEntry> = {};
  for (const [key, raw] of sanitizeRecord(value)) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    result[key] = {
      progress: sanitizeNonNegativeInt(entry.progress),
      claimedTier: sanitizeNonNegativeInt(entry.claimedTier),
    };
  }
  return result;
}

function sanitizeLoginReward(value: unknown): LoginRewardSaveState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { totalDays: 0, lastCountedDayKey: '', claimedTier: 0 };
  }
  const raw = value as Record<string, unknown>;
  return {
    totalDays: sanitizeNonNegativeInt(raw.totalDays),
    lastCountedDayKey: sanitizeString(raw.lastCountedDayKey),
    claimedTier: sanitizeNonNegativeInt(raw.claimedTier),
  };
}

function sanitizeShopState(value: unknown): ShopSaveState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { refreshDayKey: '', purchaseCounts: {} };
  }
  const raw = value as Record<string, unknown>;
  return {
    refreshDayKey: sanitizeString(raw.refreshDayKey),
    purchaseCounts: sanitizeCountMap(raw.purchaseCounts),
  };
}

function sanitizeCodexState(value: unknown): CodexSaveState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { seenIds: [], defeatedIds: [] };
  }
  const raw = value as Record<string, unknown>;
  return {
    seenIds: sanitizeStringList(raw.seenIds),
    defeatedIds: sanitizeStringList(raw.defeatedIds),
  };
}

function sanitizeOfferClaims(value: unknown): Record<string, OfferClaimSaveEntry> {
  const result: Record<string, OfferClaimSaveEntry> = {};
  for (const [key, raw] of sanitizeRecord(value)) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    result[key] = { claimCount: sanitizeNonNegativeInt(entry.claimCount) };
  }
  return result;
}

function sanitizeActivities(value: unknown): Record<string, ActivitySaveEntry> {
  const result: Record<string, ActivitySaveEntry> = {};
  for (const [key, raw] of sanitizeRecord(value)) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    result[key] = { status: sanitizeString(entry.status) };
  }
  return result;
}

function sanitizeIdentity(value: unknown): IdentitySaveState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { localGuestId: '', wxOpenId: '', accountCreatedAt: 0, lastLoginAt: 0 };
  }
  const raw = value as Record<string, unknown>;
  return {
    localGuestId: sanitizeString(raw.localGuestId),
    wxOpenId: sanitizeString(raw.wxOpenId),
    accountCreatedAt: sanitizeNonNegativeInt(raw.accountCreatedAt),
    lastLoginAt: sanitizeNonNegativeInt(raw.lastLoginAt),
  };
}

/** 音量类整数钳制到 [0, 100]，非法值落默认。 */
function sanitizeVolume(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const floored = Math.floor(value);
    return floored >= 0 && floored <= 100 ? floored : fallback;
  }
  return fallback;
}

function sanitizeSettings(value: unknown): SettingsSaveState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...DEFAULT_ACCOUNT_SETTINGS };
  }
  const raw = value as Record<string, unknown>;
  return {
    bgmVolume: sanitizeVolume(raw.bgmVolume, DEFAULT_ACCOUNT_SETTINGS.bgmVolume),
    sfxVolume: sanitizeVolume(raw.sfxVolume, DEFAULT_ACCOUNT_SETTINGS.sfxVolume),
    vibrationEnabled:
      typeof raw.vibrationEnabled === 'boolean' ? raw.vibrationEnabled : DEFAULT_ACCOUNT_SETTINGS.vibrationEnabled,
    qualityTier: Math.min(2, sanitizeNonNegativeInt(raw.qualityTier)),
    agreementVersion: sanitizeNonNegativeInt(raw.agreementVersion),
  };
}

function sanitizeGuide(value: unknown): GuideSaveState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { scriptVersion: 0, completedStepIds: [] };
  }
  const raw = value as Record<string, unknown>;
  return {
    scriptVersion: sanitizeNonNegativeInt(raw.scriptVersion),
    completedStepIds: sanitizeStringList(raw.completedStepIds),
  };
}

function sanitizeCloudSync(value: unknown): CloudSyncSaveMeta {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { lastSyncedAt: 0, lastSyncSource: '' };
  }
  const raw = value as Record<string, unknown>;
  return {
    lastSyncedAt: sanitizeNonNegativeInt(raw.lastSyncedAt),
    lastSyncSource: sanitizeString(raw.lastSyncSource),
  };
}
