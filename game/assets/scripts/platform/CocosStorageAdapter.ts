import { sys } from 'cc';

import type { StorageAdapter } from './StorageAdapter';

/**
 * Creator/微信小游戏存储适配（V05-09）：基于 Cocos sys.localStorage，
 * 预览（浏览器 localStorage）与微信小游戏（wx 存储）由引擎统一封装，
 * 业务代码不触碰平台 API。V1.0 云存档/多端同步将在 platform 层扩展，不改本接口语义。
 */
export class CocosStorageAdapter implements StorageAdapter {
  getString(key: string): string | null {
    return sys.localStorage.getItem(key);
  }

  setString(key: string, value: string): void {
    sys.localStorage.setItem(key, value);
  }

  removeKey(key: string): void {
    sys.localStorage.removeItem(key);
  }
}
