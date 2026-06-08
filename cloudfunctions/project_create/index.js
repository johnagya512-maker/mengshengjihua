// cloudfunctions/project_create/index.js — 用户手动创建项目
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

const PROJECT_COLORS = ['#7A9E7E', '#E8B98A', '#A8C0D6', '#D6A8C0', '#C0D6A8', '#D6C7A8', '#A8D6CF', '#B8A8D6'];

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const name = (event.name || '').trim();
  if (!OPENID) return fail(400, '登录态无效');
  if (!name || name.length > 30) return fail(422, '项目名 1~30 字');

  try {
    const projCol = db.collection('projects');
    // 重名直接返回已有项目，不重复创建
    const exist = (await projCol.where({ _openid: OPENID, name }).get()).data[0];
    if (exist) return ok({ project_id: exist.project_id, name: exist.name, color: exist.color, existed: true });

    const countRes = await projCol.where({ _openid: OPENID }).count();
    const color = PROJECT_COLORS[countRes.total % PROJECT_COLORS.length];
    const project_id = `p_${Date.now()}_${countRes.total}`;
    await projCol.add({ data: { _openid: OPENID, project_id, name, color, created_at: Date.now() } });
    return ok({ project_id, name, color, existed: false });
  } catch (e) {
    return fail(500, '创建失败: ' + e.message);
  }
};
