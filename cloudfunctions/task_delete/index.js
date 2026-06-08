// cloudfunctions/task_delete/index.js — 删除单条任务（用户手动清理已完成/跳过的留痕）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { task_id } = event;
  if (!OPENID) return fail(400, '登录态无效');
  if (!task_id) return fail(422, '缺少任务 ID');

  try {
    // 仅删本人任务；安全规则 + openid 双重隔离。不连带改项目（项目进度按现存任务实时算）
    const res = await db.collection('tasks').where({ _openid: OPENID, task_id }).remove();
    if (!res.stats || res.stats.removed === 0) return fail(404, '任务不存在');
    return ok({ deleted: true });
  } catch (e) {
    console.error('task_delete 失败:', e);
    return fail(500, '删除失败，请重试');
  }
};
