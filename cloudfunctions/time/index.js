/**
 * yaoling_time — 服务器时间云函数（V10-08）。
 *
 * 小游戏端经 wx.cloud.callFunction({ name: 'yaoling_time' }) 调用，
 * 返回云函数侧服务器毫秒时间戳；端侧 TimeService.syncWithServer 校准
 * 单调偏移（回拨检测/降级冻结语义见 platform/TimeService.ts）。
 *
 * 部署：与 yaoling_login 相同（上传 cloudfunctions/time/，云端安装依赖）。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  return { serverNow: Date.now() };
};
