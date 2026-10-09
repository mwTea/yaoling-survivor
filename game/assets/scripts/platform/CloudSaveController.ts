/**
 * 云存档同步（V10-09 单文件叶子模块，同 Pools.ts / Combat.ts 先例）：
 * 载荷契约、校验和、同步策略与编排控制器。零跨文件值导入（仅类型导入），
 * 可被 `game/tests/*.test.mjs` 直接以 node --experimental-strip-types 加载。
 *
 * 策略定案（LIVEOPS §5：禁止静默用旧档覆盖新档）：
 * - 方向判定**严格以 lastSavedAt（服务器时间）判新旧**——只有严格更新的一侧
 *   覆盖另一侧；校验和相同 = in_sync；时间相同内容不同 = conflict（保持本地
 *   继续玩、状态可见、不上传不下载，下次落盘获得更晚 lastSavedAt 后自然上传）；
 *   云端 schema 高于当前 = conflict（不做降级覆盖）。
 * - 节流：关键事务后的上传按最小间隔节流；失败未成功不计（上次"成功"时间
 *   才推进），恢复后下一次提交立即补同步。
 * - 成功后写存档 cloudSync 元数据域（V10-01 schema v3）并即时落盘。
 * - 同步失败/未就绪不阻断任何玩法路径（本地缓存继续玩）。
 *
 * 依赖全部注入（adapter/store/time/openid 提供者/序列化与解析函数），
 * 零 cc/wx/Date 依赖；微信实现（云数据库）在 platform/WechatCloudSaveAdapter.ts。
 */
import type { AccountStore, AccountSaveData } from '../account/AccountSave';
import type { TimeService } from './TimeService';

// —— 载荷与校验和 ——

export interface CloudSavePayload {
  readonly openid: string;
  readonly schemaVersion: number;
  readonly lastSavedAt: number;
  readonly checksum: string;
  /** 序列化存档原文（serializeAccountSave 产物）。 */
  readonly data: string;
}

export interface CloudSaveAdapter {
  /** 拉取云端存档；null = 无档或拉取失败（不抛错，断网容错由控制器处理）。 */
  load(openid: string): Promise<CloudSavePayload | null>;
  /** 上传云端存档；false = 失败（本地缓存继续玩，恢复后补同步）。 */
  save(payload: CloudSavePayload): Promise<boolean>;
}

/** FNV-1a 32 位校验和（确定性十六进制；用于改动检测，非安全摘要）。 */
export function computeChecksum(data: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 1) {
    hash ^= data.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16);
  return hex.length >= 8 ? hex : '0'.repeat(8 - hex.length) + hex;
}

export function buildCloudSavePayload(
  openid: string,
  save: AccountSaveData,
  serialize: (data: AccountSaveData) => string,
): CloudSavePayload {
  const data = serialize(save);
  // 校验和剥离 cloudSync 元数据：元数据只记录"何时同步过"，其变化不代表
  // 进度差异——否则上传后写元数据会与云端载荷产生虚假差异（自冲突）。
  const checksum = computeChecksum(
    serialize({ ...save, cloudSync: { lastSyncedAt: 0, lastSyncSource: '' } }),
  );
  return {
    openid,
    schemaVersion: save.schemaVersion,
    lastSavedAt: save.lastSavedAt,
    checksum,
    data,
  };
}

/** 开发期模拟实现：内存按 openid 存取，可注入 load/save 失败演练断网路径。 */
export class MockCloudSaveAdapter implements CloudSaveAdapter {
  private readonly store = new Map<string, CloudSavePayload>();
  private failLoad = false;
  private failSave = false;

  constructor(seed?: Array<[string, CloudSavePayload]>) {
    if (seed !== undefined) {
      for (const [openid, payload] of seed) {
        this.store.set(openid, payload);
      }
    }
  }

  public setFailLoad(fail: boolean): void {
    this.failLoad = fail;
  }

  public setFailSave(fail: boolean): void {
    this.failSave = fail;
  }

  public load(openid: string): Promise<CloudSavePayload | null> {
    if (this.failLoad) {
      return Promise.resolve(null);
    }
    return Promise.resolve(this.store.get(openid) ?? null);
  }

  public save(payload: CloudSavePayload): Promise<boolean> {
    if (this.failSave) {
      return Promise.resolve(false);
    }
    this.store.set(payload.openid, payload);
    return Promise.resolve(true);
  }
}

// —— 同步策略 ——

export const CLOUD_SAVE_UPLOAD_MIN_INTERVAL_MS = 60_000;

export type SyncDirection = 'upload' | 'download' | 'in_sync' | 'conflict';

/** 冲突原因（诊断与"我的"页展示语义）。 */
export type SyncConflictReason = 'same_timestamp_different_content' | 'cloud_schema_ahead';

export type SyncDecision =
  | { readonly direction: 'upload' | 'download' | 'in_sync' }
  | { readonly direction: 'conflict'; readonly reason: SyncConflictReason };

export function decideSyncDirection(
  local: CloudSavePayload,
  cloud: CloudSavePayload | null,
  currentSchemaVersion: number,
): SyncDecision {
  if (cloud === null) {
    return { direction: 'upload' };
  }
  if (cloud.checksum === local.checksum) {
    return { direction: 'in_sync' };
  }
  if (cloud.schemaVersion > currentSchemaVersion) {
    return { direction: 'conflict', reason: 'cloud_schema_ahead' };
  }
  if (local.lastSavedAt > cloud.lastSavedAt) {
    return { direction: 'upload' };
  }
  if (local.lastSavedAt < cloud.lastSavedAt) {
    return { direction: 'download' };
  }
  return { direction: 'conflict', reason: 'same_timestamp_different_content' };
}

export interface UploadThrottleState {
  /** 上次成功上传的服务器时间（毫秒）；-1 = 从未成功。 */
  lastUploadAt: number;
}

/** 节流判定：距上次成功上传不足间隔则跳过（失败不计入，见模块头注释）。 */
export function canUploadNow(nowMs: number, state: UploadThrottleState): boolean {
  return state.lastUploadAt < 0 || nowMs - state.lastUploadAt >= CLOUD_SAVE_UPLOAD_MIN_INTERVAL_MS;
}

export type CloudSyncSource = 'upload' | 'download';

/** 同步成功后写 cloudSync 元数据域（直接改写传入存档，落盘由调用方负责）。 */
export function applySyncOutcome(
  save: AccountSaveData,
  source: CloudSyncSource,
  serverNowMs: number,
): void {
  save.cloudSync.lastSyncedAt = serverNowMs;
  save.cloudSync.lastSyncSource = source;
}

// —— 编排控制器 ——

export type CloudSaveStatus =
  | 'disabled' // 无 openid（登录未完成）或存档未装载
  | 'in_sync'
  | 'uploaded'
  | 'downloaded'
  | 'conflict'
  | 'upload_failed';

export interface CloudSaveControllerDeps {
  readonly adapter: CloudSaveAdapter;
  readonly store: AccountStore;
  readonly time: TimeService;
  readonly getOpenid: () => string;
  readonly currentSchemaVersion: number;
  readonly serialize: (data: AccountSaveData) => string;
  readonly parse: (raw: string) => { ok: true; data: AccountSaveData } | { ok: false };
}

export class CloudSaveController {
  private readonly deps: CloudSaveControllerDeps;
  private lastUploadAt = -1;
  private status: CloudSaveStatus = 'disabled';
  private statusDetail = '';
  private syncing = false;

  constructor(deps: CloudSaveControllerDeps) {
    this.deps = deps;
  }

  public get currentStatus(): CloudSaveStatus {
    return this.status;
  }

  public get detail(): string {
    return this.statusDetail;
  }

  /** 启动同步（openid 就绪后调用；幂等，并发重入忽略）。 */
  public async syncOnStartup(): Promise<void> {
    await this.runSync(true);
  }

  /** 本地落盘后触发（节流上传；并发重入忽略）。 */
  public async onLocalSave(): Promise<void> {
    await this.runSync(false);
  }

  private async runSync(startup: boolean): Promise<void> {
    if (this.syncing) {
      return;
    }
    const openid = this.deps.getOpenid();
    const save = this.deps.store.load();
    if (openid.length === 0 || save === null) {
      this.status = 'disabled';
      this.statusDetail = 'openid 未就绪或存档未装载';
      return;
    }
    if (!startup && !canUploadNow(this.deps.time.now(), { lastUploadAt: this.lastUploadAt })) {
      return;
    }
    this.syncing = true;
    try {
      await this.syncNow(openid, save);
    } finally {
      this.syncing = false;
    }
  }

  private async syncNow(openid: string, save: AccountSaveData): Promise<void> {
    let cloud: CloudSavePayload | null = null;
    try {
      cloud = await this.deps.adapter.load(openid);
    } catch {
      cloud = null;
    }
    const local = buildCloudSavePayload(openid, save, this.deps.serialize);
    const decision = decideSyncDirection(local, cloud, this.deps.currentSchemaVersion);
    if (decision.direction === 'in_sync') {
      this.status = 'in_sync';
      this.statusDetail = '';
      return;
    }
    if (decision.direction === 'conflict') {
      // 保持本地继续玩；状态可见；不静默覆盖任何一侧。
      this.status = 'conflict';
      this.statusDetail = decision.reason;
      return;
    }
    if (decision.direction === 'download') {
      if (cloud === null) {
        // 依判定规则不可达（null 恒为 upload）；防御性保守处理。
        this.status = 'upload_failed';
        this.statusDetail = 'unexpected_null_cloud_payload';
        return;
      }
      await this.applyDownload(cloud);
      return;
    }
    await this.uploadLocal(openid, save);
  }

  private async applyDownload(cloud: CloudSavePayload): Promise<void> {
    const parsed = this.deps.parse(cloud.data);
    if (!parsed.ok) {
      // 云端载荷损坏：不覆盖本地（安全降级），状态可见。
      this.status = 'conflict';
      this.statusDetail = 'cloud_payload_unreadable';
      return;
    }
    this.deps.store.save(parsed.data);
    applySyncOutcome(this.deps.store.load(), 'download', this.deps.time.now());
    this.deps.store.save(this.deps.store.load());
    this.status = 'downloaded';
    this.statusDetail = `server=${cloud.lastSavedAt}`;
  }

  private async uploadLocal(openid: string, save: AccountSaveData): Promise<boolean> {
    const local = buildCloudSavePayload(openid, save, this.deps.serialize);
    const ok = await this.deps.adapter.save(local);
    if (ok) {
      applySyncOutcome(this.deps.store.load(), 'upload', this.deps.time.now());
      // 元数据即时落盘（校验和已剥离 cloudSync，不会与云端载荷产生虚假差异）。
      this.deps.store.save(this.deps.store.load());
      this.lastUploadAt = this.deps.time.now();
      this.status = 'uploaded';
      this.statusDetail = '';
    } else {
      this.status = 'upload_failed';
      this.statusDetail = '本地继续玩，恢复后补同步';
    }
    return ok;
  }
}
