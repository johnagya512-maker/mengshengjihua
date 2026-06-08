// cloudfunctions/project_delete/index.js — 删除项目及其下任务
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { project_id } = event;
  if (!OPENID) return fail(400, '登录态无效');
  if (!project_id) return fail(422, '缺少项目 ID');

  try {
    const proj = (await db.collection('projects').where({ _openid: OPENID, project_id }).get()).data[0];
    if (!proj) return fail(404, '项目不存在');

    // 连带删除该项目下的任务（按 project_tag 关联）
    await db.collection('tasks').where({ _openid: OPENID, project_tag: proj.name }).remove();
    await db.collection('projects').where({ _openid: OPENID, project_id }).remove();
    return ok({ deleted: true });
  } catch (e) {
    return fail(500, '删除失败: ' + e.message);
  }
};
