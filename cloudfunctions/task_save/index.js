// cloudfunctions/task_save/index.js — 确认卡片写入任务队列（含项目归类）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

const PROJECT_COLORS = ['#7A9E7E', '#E8B98A', '#A8C0D6', '#D6A8C0', '#C0D6A8', '#D6C7A8', '#A8D6CF', '#B8A8D6'];
const DURATION_ENUM = [15, 30, 45, 60, 75, 90, 105, 120];

// 东八区今日 YYYY-MM-DD
function todayStr() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function genId() { return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { action, duration, project_tag, vision_statement, is_priority, parent_task_id, parent_action, parent_duration, sub_index, sub_total, repeat } = event;
  if (!OPENID) return fail(400, '登录态无效');

  // 字段校验。愿景非必填：碎任务留白，仅「大事」的步骤才配愿景
  if (!action || action.length > 100) return fail(422, '任务目标无效');
  // 子任务(有 parent_task_id)的 duration 是大任务总时长的均摊值，不必是标准枚举，只要是正数即可；
  // 独立任务仍要求选标准耗时档位。
  const durNum = Number(duration);
  if (parent_task_id) {
    if (!(durNum > 0)) return fail(422, '耗时无效');
  } else if (!DURATION_ENUM.includes(durNum)) {
    return fail(422, '请选择耗时');
  }
  if (vision_statement && vision_statement.length > 80) return fail(422, '愿景文案过长');

  try {
    // 归类规则：命中用户已建的同名项目则归入；否则不归任何项目（project_id 留空）。
    // 不再自动创建「随手记」兜底项目——零散任务照常进今日清单与复盘，只是不挂项目。
    const projCol = db.collection('projects');
    let projectId = '';
    let projectTag = '';

    if (project_tag) {
      const proj = (await projCol.where({ _openid: OPENID, name: project_tag }).get()).data[0];
      if (proj) { projectId = proj.project_id; projectTag = project_tag; }
    }
    // task_id 加随机后缀：子任务批量保存可能落在同毫秒，纯时间戳会碰撞
    const isDaily = repeat === 'daily';
    const baseFields = {
      _openid: OPENID, project_id: projectId, project_tag: projectTag,
      action, duration: Number(duration), vision_statement: vision_statement || '',
      type: 'normal', is_priority: !!is_priority, created_at: Date.now(),
      parent_task_id: parent_task_id || '', parent_action: parent_action || '',
      // 大事拆分：时间只在大任务，子任务存父总时长 + 序号（duration 为均摊值，仅供容量累加）
      parent_duration: Number(parent_duration) || 0,
      sub_index: Number.isInteger(sub_index) ? sub_index : -1,
      sub_total: Number(sub_total) || 0,
    };

    if (isDaily) {
      // 每日重复：存「母本」（template，不排期不展示）+ 立即建当天实例，使当天即可见
      const tplId = genId();
      await db.collection('tasks').add({
        data: { ...baseFields, task_id: tplId, status: 'template', repeat: 'daily', scheduled_time: '' },
      });
      const instId = genId();
      await db.collection('tasks').add({
        data: {
          ...baseFields, task_id: instId, status: 'pending', scheduled_time: '',
          repeat: 'none', repeat_parent_id: tplId, repeat_date: todayStr(),
        },
      });
      return ok({ task_id: instId, project_id: projectId, template_id: tplId });
    }

    const task_id = genId();
    await db.collection('tasks').add({
      data: { ...baseFields, task_id, status: 'pending', scheduled_time: '', repeat: 'none' },
    });
    return ok({ task_id, project_id: projectId });
  } catch (e) {
    console.error('task_save 失败:', e);
    return fail(500, '保存失败，请重试');
  }
};
