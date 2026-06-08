// cloudfunctions/auth_login/index.js — 微信授权登录
const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

// HMAC-SHA256 签名 token：payload=openid.exp，附签名防伪造。
// 密钥从环境变量 TOKEN_SECRET 读取（部署时在云开发控制台配置）。
// 注意：真正的鉴权基线仍是 getWXContext().OPENID（云端注入、不可伪造）；
// 本 token 用于需要在 payload 中携带过期信息、且可被服务端校验的场景。
function tokenSecret() {
  return process.env.TOKEN_SECRET || 'mengsheng-dev-secret-change-me';
}
function signToken(openid) {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = `${openid}.${exp}`;
  const sig = crypto.createHmac('sha256', tokenSecret()).update(payload).digest('base64url');
  return Buffer.from(`${payload}.${sig}`).toString('base64');
}

// 新用户默认 Profile（无引导，安全种子；之后由隐形学习校正）
const DEFAULT_PROFILE = {
  peak_hours: ['09:00-11:00', '15:00-17:00'], // 通用双峰
  focus_tolerance: 45,
  pain_task_types: [],
  ideal_work_hours: 6,
};

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail(400, 'code 无效或已过期');

  const users = db.collection('users');
  let userId = '';

  try {
    const res = await users.where({ _openid: OPENID }).get();
    const now = Date.now();
    if (res.data.length === 0) {
      // 首次登录：建用户记录 + 静默写默认 Profile（无引导）
      userId = `u_${OPENID.slice(-12)}`;
      await users.add({ data: { _openid: OPENID, user_id: userId, created_at: now, last_login: now } });
      const profExist = await db.collection('profiles').where({ _openid: OPENID }).count();
      if (profExist.total === 0) {
        await db.collection('profiles').add({
          data: { _openid: OPENID, ...DEFAULT_PROFILE, user_id: userId, created_at: now },
        });
      }
    } else {
      userId = res.data[0].user_id;
      await users.doc(res.data[0]._id).update({ data: { last_login: now } });
      // 老用户登录即静默触发隐形学习（规则2/3/5）。非阻塞：不 await，
      // 失败也不能影响登录。冷启动门槛由 profile_learn 内部把关。
      cloud.callFunction({ name: 'profile_learn' }).catch(() => {});
    }

    // 无引导：始终直接进主界面
    return ok({ token: signToken(OPENID), is_new_user: false, user_id: userId });
  } catch (e) {
    return fail(500, '微信接口调用失败');
  }
};
