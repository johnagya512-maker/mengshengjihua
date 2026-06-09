// cloudfunctions/project_achievement/index.js — 手动成就：记里程碑 / 删里程碑
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

// 内容安全：成就文本（UGC）入库前检测，异常放行
async function isTextSafe(text, openid) {
  const content = String(text || '').trim();
  if (!content) return true;
  try {
    const r = await cloud.openapi.security.msgSecCheck({ version: 2, scene: 1, openid, content: content.slice(0, 2500) });
    return r && r.result && r.result.suggest === 'pass';
  } catch (e) { console.error('msgSecCheck 异常，放行:', e && e.errCode); return true; }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { action, project_id, text, ach_id } = event;
  if (!OPENID) return fail(400, '登录态无效');
  if (!project_id) return fail(422, '缺少项目 ID');

  try {
    const projCol = db.collection('projects');
    // 仅操作本人项目
    const proj = (await projCol.where({ _openid: OPENID, project_id }).get()).data[0];
    if (!proj) return fail(404, '项目不存在');

    if (action === 'add') {
      const t = (text || '').trim();
      if (!t || t.length > 40) return fail(422, '成就 1~40 字');
      // 内容安全：成就文本违规拦截
      if (!(await isTextSafe(t, OPENID))) return fail(422, '内容含违规信息，换个说法试试');
      const ach = { ach_id: `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, text: t, created_at: Date.now() };
      await projCol.doc(proj._id).update({ data: { achievements: _.push([ach]) } });
      return ok({ achievement: ach });
    }

    if (action === 'delete') {
      if (!ach_id) return fail(422, '缺少成就 ID');
      const rest = (proj.achievements || []).filter((a) => a.ach_id !== ach_id);
      await projCol.doc(proj._id).update({ data: { achievements: rest } });
      return ok({ deleted: true });
    }

    return fail(422, '未知操作');
  } catch (e) {
    console.error('project_achievement 失败:', e);
    return fail(500, '操作失败，请重试');
  }
};
