// cloudfunctions/profile_learn/index.js — 隐形学习：静默校正 profile（每日定时或首次登录触发）
const cloud = require('wx-server-sdk');
const { learn } = require('./learn');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

const WINDOW_MS = 21 * 86400 * 1000;

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail(400, '登录态无效');
  const nowMs = Date.now();
  const cutoff = nowMs - WINDOW_MS;

  try {
    // 近 3 周已完成任务（规则2/3 的数据源）
    const doneRes = await db.collection('tasks')
      .where({ _openid: OPENID, status: 'done', finished_at: _.gte(cutoff) })
      .field({ duration: true, actual_duration: true, finished_at: true, type: true })
      .limit(1000).get();

    // 近 3 周跳过日志（规则5）
    const skipRes = await db.collection('skip_logs')
      .where({ _openid: OPENID, created_at: _.gte(cutoff) })
      .field({ skip_reason: true, created_at: true })
      .limit(1000).get();

    const { updates, learning_meta } = learn({
      doneTasks: doneRes.data, skipLogs: skipRes.data, nowMs,
    });

    // 冷启动或无可学增量：只记 meta，不动种子参数（护栏1）
    const exist = await db.collection('profiles').where({ _openid: OPENID })
      .field({ _id: true, ideal_work_hours_manual: true }).get();
    // 护栏：用户手动设过每日容量，学习不再覆盖（尊重明确意愿，规则2只在未手设时生效）
    if (exist.data[0] && exist.data[0].ideal_work_hours_manual) {
      delete updates.ideal_work_hours;
    }
    const patch = { ...updates, learning_meta, learned_at: nowMs };
    if (exist.data.length === 0) {
      // 理论上登录已建 profile；兜底，避免学习先于初始化时丢数据
      await db.collection('profiles').add({ data: { _openid: OPENID, ...patch } });
    } else {
      await db.collection('profiles').doc(exist.data[0]._id).update({ data: patch });
    }
    return ok({ applied: Object.keys(updates), learning_meta });
  } catch (e) {
    console.error('profile_learn 失败:', e);
    return fail(500, '学习失败，请重试');
  }
};
