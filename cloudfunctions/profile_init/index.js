// cloudfunctions/profile_init/index.js — 写入用户 Profile（排期种子）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

const TIME_RE = /^\d{2}:\d{2}-\d{2}:\d{2}$/;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail(400, '登录态无效');

  const { peak_hours, pain_task_types, ideal_work_hours, user_id, focus_tolerance } = event;

  // 校验：高峰时段由作息推导，仍校验格式；头疼类型已不强制收集
  if (!Array.isArray(peak_hours) || peak_hours.length < 1 || !peak_hours.every((h) => TIME_RE.test(h)))
    return fail(422, '请选择你的专注高峰');
  if (typeof ideal_work_hours !== 'number' || ideal_work_hours < 1 || ideal_work_hours > 12)
    return fail(422, '请设置每日工作时长');

  const profiles = db.collection('profiles');
  try {
    const exist = await profiles.where({ _openid: OPENID }).get();
    const data = {
      peak_hours,
      pain_task_types: Array.isArray(pain_task_types) ? pain_task_types : [],
      ideal_work_hours,
      focus_tolerance: Number(focus_tolerance) || 45,
      user_id,
      created_at: Date.now(),
    };
    if (exist.data.length === 0) {
      await profiles.add({ data: { _openid: OPENID, ...data } });
    } else {
      await profiles.doc(exist.data[0]._id).update({ data });
    }
  } catch (e) {
    return fail(500, '写入失败');
  }
  return ok({ success: true });
};
