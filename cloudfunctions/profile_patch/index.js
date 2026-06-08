// cloudfunctions/profile_patch/index.js — 单字段更新用户 Profile（白名单，避免全量覆盖冲掉其他字段）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail(400, '登录态无效');

  // 白名单：只允许更新这些字段，杜绝越权写入与误覆盖
  const patch = {};
  if (event.ideal_work_hours !== undefined) {
    const h = Number(event.ideal_work_hours);
    if (!(h >= 1 && h <= 12)) return fail(422, '每日时长需在 1~12 小时之间');
    patch.ideal_work_hours = h;
  }
  if (Object.keys(patch).length === 0) return fail(422, '没有可更新的字段');

  const profiles = db.collection('profiles');
  try {
    const exist = await profiles.where({ _openid: OPENID }).get();
    if (exist.data.length === 0) return fail(404, '画像不存在，请先完成引导');
    await profiles.doc(exist.data[0]._id).update({ data: patch });
  } catch (e) {
    return fail(500, '更新失败');
  }
  return ok({ success: true, ...patch });
};
