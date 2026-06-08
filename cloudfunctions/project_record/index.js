// cloudfunctions/project_record/index.js — result 模式「记一笔」(方向 v1.1 §6.7)
// 更新 current_value：跨周期(月/周)先归零再记，否则在原值上累加。
const cloud = require('wx-server-sdk');
const { applyRecord } = require('./period');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { project_id, delta } = event;
  if (!OPENID) return fail(400, '登录态无效');
  if (!project_id) return fail(422, '缺少 project_id');
  const d = Number(delta);
  if (!isFinite(d) || d === 0) return fail(422, '记一笔的数值无效');

  try {
    const projCol = db.collection('projects');
    const proj = (await projCol.where({ _openid: OPENID, project_id }).get()).data[0];
    if (!proj) return fail(422, '项目不存在');
    if (proj.mode !== 'result') return fail(422, '只有数值型项目能记一笔');

    const nowMs = Date.now();
    const newValue = applyRecord({
      cycle: proj.cycle || 'none',
      current_value: proj.current_value || 0,
      current_value_at: proj.current_value_at || 0,
      delta: d,
      nowMs,
    });

    await projCol.doc(proj._id).update({
      data: { current_value: newValue, current_value_at: nowMs },
    });
    return ok({ project_id, current_value: newValue, current_value_at: nowMs });
  } catch (e) {
    console.error('project_record 失败:', e);
    return fail(500, '记录失败，请重试');
  }
};
