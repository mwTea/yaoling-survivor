/**
 * 平台存储适配接口（ARCHITECTURE.md 平台边界，V05-01 建立）。
 * 业务代码不得直接使用 localStorage / wx.* 等平台 API；
 * Creator 装配层接入具体实现（后续任务提供 Cocos/微信实现），
 * 纯逻辑测试使用内存实现。
 */
export interface StorageAdapter {
  /** 读取字符串值；不存在时返回 null。 */
  getString(key: string): string | null;
  /** 写入字符串值（覆盖旧值）。 */
  setString(key: string, value: string): void;
  /** 移除指定 key。 */
  removeKey(key: string): void;
}

/** 测试与非装配环境的内存实现。 */
export class MemoryStorageAdapter implements StorageAdapter {
  private entries = new Map<string, string>();

  getString(key: string): string | null {
    const value = this.entries.get(key);
    return value === undefined ? null : value;
  }

  setString(key: string, value: string): void {
    this.entries.set(key, value);
  }

  removeKey(key: string): void {
    this.entries.delete(key);
  }
}
