// cloudfunctions/review_week/index.js — 本周复盘聚合（只读现有数据，方向 v1.1 §4）
const cloud = require('wx-server-sdk');
const _ = require('./review');
const { review } = _;
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const cmd = db.command;

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

const WINDOW_MS = 14 * 86400 * 1000; // 取近两周，足够覆盖本周

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail(400, '登录态无效');
  const nowMs = Date.now();
  const cutoff = nowMs - WINDOW_MS;

  try {
    const doneRes = await db.collection('tasks')
      .where({ _openid: OPENID, status: 'done', finished_at: cmd.gte(cutoff) })
      .field({ project_id: true, duration: true, actual_duration: true, finished_at: true })
      .limit(1000).get();

    const skipRes = await db.collection('skip_logs')
      .where({ _openid: OPENID, created_at: cmd.gte(cutoff) })
      .field({ skip_reason: true, created_at: true })
      .limit(1000).get();

    const projRes = await db.collection('projects')
      .where({ _openid: OPENID })
      .field({ project_id: true, name: true, color: true })
      .get();

    const result = review({
      doneTasks: doneRes.data,
      skipLogs: skipRes.data,
      projects: projRes.data,
      nowMs,
    });
    return ok(result);
  } catch (e) {
    console.error('review_week 失败:', e);
    return fail(500, '加载失败，请重试');
  }
};
