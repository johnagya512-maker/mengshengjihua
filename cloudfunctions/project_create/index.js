// cloudfunctions/project_create/index.js — 用户手动创建项目
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

const PROJECT_COLORS = ['#7A9E7E', '#E8B98A', '#A8C0D6', '#D6A8C0', '#C0D6A8', '#D6C7A8', '#A8D6CF', '#B8A8D6'];
const MODES = ['count', 'streak', 'result'];

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const name = (event.name || '').trim();
  if (!OPENID) return fail(400, '登录态无效');
  if (!name || name.length > 30) return fail(422, '项目名 1~30 字');

  // 模式与标准（用户建项目时手动选，不调 AI）
  const mode = MODES.includes(event.mode) ? event.mode : 'count';
  const goal_target = Number(event.goal_target) > 0 ? Number(event.goal_target) : null;
  const daily_quota = Number(event.daily_quota) > 0 ? Number(event.daily_quota) : null;
  const goal_unit = typeof event.goal_unit === 'string' ? event.goal_unit.slice(0, 10) : '';
  const cycle = ['month', 'week', 'none'].includes(event.cycle) ? event.cycle : 'none';

  try {
    const projCol = db.collection('projects');
    // 重名直接返回已有项目，不重复创建
    const exist = (await projCol.where({ _openid: OPENID, name }).get()).data[0];
    if (exist) return ok({ project_id: exist.project_id, name: exist.name, color: exist.color, existed: true });

    const countRes = await projCol.where({ _openid: OPENID }).count();
    const color = PROJECT_COLORS[countRes.total % PROJECT_COLORS.length];
    const project_id = `p_${Date.now()}_${countRes.total}`;
    const data = {
      _openid: OPENID, project_id, name, color, created_at: Date.now(),
      mode, goal_target, daily_quota, goal_unit, cycle,
      current_value: mode === 'result' ? 0 : null,
      current_value_at: null,
    };
    await projCol.add({ data });
    return ok({ project_id, name, color, mode, existed: false });
  } catch (e) {
    console.error('project_create 失败:', e);
    return fail(500, '创建失败，请重试');
  }
};
