import { MockCloudSaveAdapter } from './CloudSaveController';
import type { CloudSaveAdapter, CloudSavePayload } from './CloudSaveController';

/**
 * 微信云存档实现（V10-09，wx 全局绑定层）：云数据库集合 `account_saves`，
 * 文档 _id = openid，内容为 CloudSavePayload。客户端直连云数据库
 * （无需云函数）；集合权限配置为"仅创建者可读写"（部署见任务记录）。
 * 任何失败以 null/false 返回不抛错；业务代码零 `wx.*`。
 */

export const CLOUD_SAVE_COLLECTION = 'account_saves';

interface WxDocHandle {
  get?: (options?: {
    success?: (res: { data?: unknown }) => void;
    fail?: (err: { errMsg?: string }) => void;
  }) => void;
  set?: (options: {
    data: unknown;
    success?: (res: unknown) => void;
    fail?: (err: { errMsg?: string }) => void;
  }) => void;
}

interface WxDatabaseLike {
  collection?: (name: string) => { doc?: (docId: string) => WxDocHandle };
}

interface WxCloudEnv {
  cloud?: { database?: (options?: { env?: string }) => WxDatabaseLike };
}

export class WechatCloudSaveAdapter implements CloudSaveAdapter {
  private readonly cloudEnvId: string | null;

  constructor(cloudEnvId: string | null = null) {
    this.cloudEnvId = cloudEnvId;
  }

  public load(openid: string): Promise<CloudSavePayload | null> {
    const doc = this.docHandle(openid);
    if (doc === null) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      doc.get?.({
        success: (res) => resolve(extractPayload(res.data)),
        fail: () => resolve(null),
      });
    });
  }

  public save(payload: CloudSavePayload): Promise<boolean> {
    const doc = this.docHandle(payload.openid);
    if (doc === null) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      doc.set?.({
        data: payload,
        success: () => resolve(true),
        fail: () => resolve(false),
      });
    });
  }

  private docHandle(openid: string): WxDocHandle | null {
    const wx = (globalThis as { wx?: WxCloudEnv }).wx;
    const database = wx?.cloud?.database;
    if (database === undefined) {
      return null;
    }
    try {
      const db = database({ env: this.cloudEnvId ?? undefined });
      const collection = db.collection?.(CLOUD_SAVE_COLLECTION);
      if (collection === undefined || collection.doc === undefined) {
        return null;
      }
      const handle = collection.doc(openid);
      return handle ?? null;
    } catch {
      return null;
    }
  }
}

function extractPayload(raw: unknown): CloudSavePayload | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const openid = record.openid;
  const schemaVersion = record.schemaVersion;
  const lastSavedAt = record.lastSavedAt;
  const checksum = record.checksum;
  const data = record.data;
  if (
    typeof openid !== 'string' || openid.length === 0 ||
    typeof schemaVersion !== 'number' ||
    typeof lastSavedAt !== 'number' ||
    typeof checksum !== 'string' || checksum.length === 0 ||
    typeof data !== 'string' || data.length === 0
  ) {
    return null;
  }
  return { openid, schemaVersion, lastSavedAt, checksum, data };
}

/**
 * 云存档适配器工厂：有 wx 云数据库环境走微信实现；Creator 预览等回退
 * Mock（内存模拟，日志标注）。
 */
export function createCloudSaveAdapter(cloudEnvId: string | null = null): CloudSaveAdapter {
  const wx = (globalThis as { wx?: WxCloudEnv }).wx;
  if (wx !== undefined && wx.cloud?.database !== undefined) {
    return new WechatCloudSaveAdapter(cloudEnvId);
  }
  console.log('[CloudSave] no wx/cloud database environment, using MockCloudSaveAdapter (dev preview)');
  return new MockCloudSaveAdapter();
}
