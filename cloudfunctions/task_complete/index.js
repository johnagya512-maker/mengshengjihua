// cloudfunctions/task_complete/index.js — 任务完成/跳过
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

const SKIP_REASONS = ['没状态', '等待外部', '临时取消'];

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { task_id, actual_duration, result, skip_reason } = event;
  if (!OPENID) return fail(400, '登录态无效');
  if (!task_id) return fail(422, '缺少 task_id');
  if (result !== 'complete' && result !== 'skip') return fail(422, '无效的状态');
  if (result === 'skip' && !SKIP_REASONS.includes(skip_reason)) return fail(422, '请选择跳过原因');

  const tasks = db.collection('tasks');
  try {
    const res = await tasks.where({ _openid: OPENID, task_id }).get();
    if (res.data.length === 0) return fail(422, '任务不存在');

    const task = res.data[0];
    // 幂等保护：已完成/已跳过的任务再次提交（离线回放、网络重试）直接返回，
    // 不重复刷新 finished_at、不重复写 skip_logs，避免容量虚高与回避分被放大。
    if (task.status === 'done' || task.status === 'skip') {
      const nextRes = await tasks
        .where({ _openid: OPENID, status: 'pending' })
        .orderBy('scheduled_time', 'asc')
        .limit(1)
        .get();
      return ok({ success: true, idempotent: true, next_task_id: nextRes.data[0]?.task_id || '' });
    }

    await tasks.doc(task._id).update({
      data: {
        status: result === 'complete' ? 'done' : 'skip',
        actual_duration: Number(actual_duration) || task.duration,
        ...(result === 'skip' ? { skip_reason } : {}),
        finished_at: Date.now(),
      },
    });

    // 跳过写入隐形学习数据
    if (result === 'skip') {
      await db.collection('skip_logs').add({
        data: { _openid: OPENID, task_id, skip_reason, created_at: Date.now() },
      });
    }

    // 找下一条 pending（按 scheduled_time）
    const nextRes = await tasks
      .where({ _openid: OPENID, status: 'pending' })
      .orderBy('scheduled_time', 'asc')
      .limit(1)
      .get();
    const next_task_id = nextRes.data[0]?.task_id || '';

    return ok({ success: true, next_task_id });
  } catch (e) {
    console.error('task_complete 失败:', e);
    return fail(500, '提交失败，请重试');
  }
};
