/**
 * 引导表现层共享内核（V10-04）：锚点注册表、表现层刷新通知与语义事件唯一
 * 写入口。单开模块避免 GuideOverlay/GuideDriver 循环依赖。
 *
 * - 锚点：GuideAnchor 组件登记节点；缺失/未知锚点由表现层回退居中（不报错）。
 * - 事件：emitGuideEvent 为引导域唯一写入口（状态机幂等由 GuideSystem 保证），
 *   推进后落盘并通知全部表现层刷新。
 */
import { AccountSystem } from '../account/AccountSystem';
import { handleGuideEvent } from '../account/GuideSystem';
import type { GuideEventId } from '../config/ConfigTypes';
import { INITIAL_GAME_CONFIG } from '../config/GameConfig';
import { Node, UITransform } from 'cc';

import { trackAnalytics } from '../platform/AnalyticsService';
import type { AnalyticsEventName } from '../platform/AnalyticsCore';

// —— 锚点注册表 ——

const anchors = new Map<string, Node>();

export function registerGuideAnchor(anchorId: string, node: Node): void {
  if (anchorId.length > 0) {
    anchors.set(anchorId, node);
  }
}

export function unregisterGuideAnchor(anchorId: string, node: Node): void {
  if (anchors.get(anchorId) === node) {
    anchors.delete(anchorId);
  }
}

/**
 * 解析锚点位置并转换到 space（遮罩层本地坐标系）；未知/失效锚点返回 null
 * （表现层回退居中）。战斗世界层与 UI 层不同坐标系：必须以表现层自身的
 * UITransform 作参照，不能用锚点父级（否则高亮环会错位到世界坐标）。
 */
export function resolveAnchorPosition(
  anchorId: string,
  space: UITransform,
): { x: number; y: number } | null {
  const node = anchors.get(anchorId);
  if (node === undefined || !node.isValid) {
    return null;
  }
  const world = node.worldPosition;
  const local = space.convertToNodeSpaceAR(world);
  return { x: local.x, y: local.y };
}

// —— 表现层刷新通知 ——

type GuideStateListener = () => void;

const listeners = new Set<GuideStateListener>();

/** 漏斗六步（与 AnalyticsEventName 同名子集；home/battle 过程事件不埋）。 */
const GUIDE_FUNNEL_ANALYTICS_EVENTS: ReadonlyMap<string, AnalyticsEventName> = new Map([
  ['guide_move_started', 'guide_move_started'],
  ['guide_attack_fired', 'guide_attack_fired'],
  ['guide_xp_collected', 'guide_xp_collected'],
  ['guide_levelup_resolved', 'guide_levelup_resolved'],
  ['guide_settlement_shown', 'guide_settlement_shown'],
  ['guide_cultivate_opened', 'guide_cultivate_opened'],
]);

export function onGuideStateChanged(listener: GuideStateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyGuideStateChanged(): void {
  // Array.from 展开（CODE_STYLE：禁止 [...Set/Map]，微信 Babel loose 会编译坏）。
  for (const listener of Array.from(listeners)) {
    listener();
  }
}

// —— 语义事件唯一写入口 ——

/**
 * 把引导语义事件写入存档引导域：账号服务未装配（直开战斗场景）时静默忽略——
 * 引导仅在有账号链路时生效。事件推进存档后落盘并通知表现层。
 */
export function emitGuideEvent(event: GuideEventId): void {
  const account = AccountSystem.instance;
  const save = account?.accountSave ?? null;
  if (account === null || save === null) {
    return;
  }
  const result = handleGuideEvent(INITIAL_GAME_CONFIG.guide, save.guide, event);
  if (result.progressed) {
    // 新手漏斗埋点（V10-12）：仅六步闭环事件（battle_started 等过程事件不在此重复埋）。
    const funnelEvent = GUIDE_FUNNEL_ANALYTICS_EVENTS.get(event);
    if (funnelEvent !== undefined) {
      trackAnalytics(funnelEvent, {});
    }
    account.persistSave();
    console.log(
      `[GuideDriver] ${result.kind}: ${result.stepId ?? ''}` +
        `${result.scriptCompleted ? ' (script completed)' : ''}`,
    );
    notifyGuideStateChanged();
  }
}
