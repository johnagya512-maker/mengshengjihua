// cloudfunctions/task_defer/index.js — 把任务移到次日队列（容量饱和时用户确认移次日）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

// 东八区「明日」日期 YYYY-MM-DD
function tomorrowStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000 + 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { task_id } = event;
  if (!OPENID) return fail(400, '登录态无效');
  if (!task_id) return fail(422, '缺少 task_id');

  try {
    const tomorrow = tomorrowStr();
    // 标记次日 + 清空今日排期时间；跨天后该日期 <= 当天，会自动重新进入今日队列
    const res = await db.collection('tasks')
      .where({ _openid: OPENID, task_id, status: 'pending' })
      .update({ data: { scheduled_date: tomorrow, scheduled_time: '' } });
    if (!res.stats || res.stats.updated === 0) return fail(404, '任务不存在或已处理');
    return ok({ deferred: true, scheduled_date: tomorrow });
  } catch (e) {
    console.error('task_defer 失败:', e);
    return fail(500, '操作失败，请重试');
  }
};
