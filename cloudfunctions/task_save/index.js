// cloudfunctions/task_save/index.js — 确认卡片写入任务队列（含项目归类）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

const PROJECT_COLORS = ['#7A9E7E', '#E8B98A', '#A8C0D6', '#D6A8C0', '#C0D6A8', '#D6C7A8', '#A8D6CF', '#B8A8D6'];
const DURATION_ENUM = [15, 30, 45, 60, 75, 90, 105, 120];

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { action, duration, project_tag, vision_statement, is_priority, parent_task_id, parent_action } = event;
  if (!OPENID) return fail(400, '登录态无效');

  // 字段校验。愿景非必填：碎任务留白，仅「大事」的步骤才配愿景
  if (!action || action.length > 100) return fail(422, '任务目标无效');
  if (!DURATION_ENUM.includes(Number(duration))) return fail(422, '请选择耗时');
  if (vision_statement && vision_statement.length > 80) return fail(422, '愿景文案过长');

  try {
    // 归类规则：命中用户已建的同名项目则归入；否则统一进「随手记」兜底分类。
    // 「随手记」是唯一允许系统自动维护的默认项目，作为收件箱 + 报告统计兜底。
    const projCol = db.collection('projects');
    let projectId = '';
    let projectTag = '';

    if (project_tag) {
      const proj = (await projCol.where({ _openid: OPENID, name: project_tag }).get()).data[0];
      if (proj) { projectId = proj.project_id; projectTag = project_tag; }
    }

    if (!projectId) {
      let inbox = (await projCol.where({ _openid: OPENID, name: '随手记' }).get()).data[0];
      if (!inbox) {
        const countRes = await projCol.where({ _openid: OPENID }).count();
        const color = PROJECT_COLORS[countRes.total % PROJECT_COLORS.length];
        const project_id = `p_${Date.now()}_${countRes.total}`;
        await projCol.add({ data: { _openid: OPENID, project_id, name: '随手记', color, created_at: Date.now() } });
        inbox = { project_id };
      }
      projectId = inbox.project_id;
      projectTag = '随手记';
    }
    const task_id = `t_${Date.now()}`;
    await db.collection('tasks').add({
      data: {
        _openid: OPENID, task_id, project_id: projectId, project_tag: projectTag,
        action, duration: Number(duration), vision_statement,
        type: 'normal', status: 'pending', scheduled_time: '',
        is_priority: !!is_priority, created_at: Date.now(),
        parent_task_id: parent_task_id || '',
        parent_action: parent_action || '',
      },
    });
    return ok({ task_id, project_id: projectId });
  } catch (e) {
    return fail(500, '保存失败: ' + e.message);
  }
};
