// cloudfunctions/schedule_compute/index.js — 排期引擎云函数
const cloud = require('wx-server-sdk');
const { schedule, dailyCapacity } = require('./scheduler');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

function todayStr() {
  // 云函数 UTC，转东八区
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
function nowMinuteCST() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
// 东八区今日 0 点的时间戳（毫秒），用于筛「今日完成」
function todayStartMs() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const dayStartCST = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return dayStartCST - 8 * 3600 * 1000;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { trigger } = event;
  if (!OPENID) return fail(400, '登录态无效');

  try {
    // 1. 取 profile
    const profRes = await db.collection('profiles').where({ _openid: OPENID }).get();
    const profile = profRes.data[0] || { ideal_work_hours: 6, peak_hours: [] };

    // 2. 取今日 pending 任务
    const taskRes = await db.collection('tasks')
      .where({ _openid: OPENID, status: 'pending', type: _.neq('gap') })
      .get();
    const tasks = taskRes.data;

    // 3. 历史跳过统计（隐形学习规则5）：按任务分桶归因，供排期加权
    //    { task_id: { 没状态: n, 等待外部: n, 临时取消: n } }
    const skipRes = await db.collection('skip_logs').where({ _openid: OPENID }).get();
    const skipStats = {};
    skipRes.data.forEach((s) => {
      const bucket = (skipStats[s.task_id] = skipStats[s.task_id] || {});
      const reason = s.skip_reason || '临时取消';
      bucket[reason] = (bucket[reason] || 0) + 1;
    });

    // 4. 已用时长（今日已完成任务实际耗时）。仅算今日，避免容量永不归零
    const dayStart = todayStartMs();
    const doneRes = await db.collection('tasks')
      .where({ _openid: OPENID, status: 'done', finished_at: _.gte(dayStart) }).get();
    const usedDone = doneRes.data.reduce((s, t) => s + (t.actual_duration || t.duration || 0), 0);
    const doneToday = doneRes.data.length;

    // 4b. 已完成 / 跳过历史（首页留痕，倒序，上限 50 条；更早的仍在库里，只是首页不展示）
    const historyRes = await db.collection('tasks')
      .where({ _openid: OPENID, status: _.in(['done', 'skip']) })
      .orderBy('finished_at', 'desc')
      .limit(50)
      .get();
    const done_tasks = historyRes.data;

    const nowMin = trigger === 'daily_init'
      ? (profile.peak_hours[0] ? parseInt(profile.peak_hours[0], 10) * 60 : 540)
      : nowMinuteCST();

    const result = schedule({ tasks, profile, nowMinute: nowMin, skipStats });

    // 5. 持久化排期时间（静默更新）
    const updates = result.ordered_tasks
      .filter((t) => t.type === 'normal' && t.task_id)
      .map((t) =>
        db.collection('tasks').where({ _openid: OPENID, task_id: t.task_id })
          .update({ data: { scheduled_time: t.scheduled_time } }).catch(() => {})
      );
    await Promise.all(updates);

    // 6. 写当日容量
    const date = todayStr();
    const capTotal = dailyCapacity(profile.ideal_work_hours || 6);
    const capUsed = usedDone + result.daily_capacity_used;
    const capCol = db.collection('daily_capacity');
    const capExist = await capCol.where({ _openid: OPENID, date }).get();
    const capData = { capacity_total: capTotal, capacity_used: capUsed };
    if (capExist.data.length === 0) await capCol.add({ data: { _openid: OPENID, date, ...capData } });
    else await capCol.doc(capExist.data[0]._id).update({ data: capData });

    return ok({
      ordered_tasks: result.ordered_tasks,
      overflow_tasks: result.overflow_tasks,
      daily_capacity_used: capUsed,
      daily_capacity_total: capTotal,
      done_today: doneToday,
      done_tasks,
    });
  } catch (e) {
    return fail(500, '排期计算失败: ' + e.message);
  }
};
