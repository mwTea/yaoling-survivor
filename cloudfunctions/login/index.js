/**
 * yaoling_login — 微信登录云函数（V10-07）。
 *
 * 小游戏端经 wx.cloud.callFunction({ name: 'yaoling_login' }) 调用；
 * 云函数上下文自动携带调用者身份（getWXContext），直接返回 openid，
 * 无需 code2Session（AppSecret 不落任何代码仓库）。
 *
 * 部署（用户前置：mp 后台开通云开发并授权）：
 * 1. 微信开发者工具 → 云开发 → 环境开通（记录环境 ID）。
 * 2. project.config.json 配置 cloudfunctionRoot 指向本目录（或右键上传）。
 * 3. 上传并部署：云端安装依赖（wx-server-sdk）。
 *
 * 返回：{ openid, appid, unionid }；异常抛出由端侧 fail 路径降级访客。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  const ctx = cloud.getWXContext();
  return {
    openid: ctx.OPENID,
    appid: ctx.APPID,
    unionid: ctx.UNIONID,
  };
};
