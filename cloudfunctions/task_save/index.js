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
  const { action, duration, project_tag, vision_statement, is_priority, parent_task_id, parent_action, repeat } = event;
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
    // task_id 加随机后缀：子任务批量保存可能落在同毫秒，纯时间戳会碰撞
    const isDaily = repeat === 'daily';
    const baseFields = {
      _openid: OPENID, project_id: projectId, project_tag: projectTag,
      action, duration: Number(duration), vision_statement: vision_statement || '',
      type: 'normal', is_priority: !!is_priority, created_at: Date.now(),
      parent_task_id: parent_task_id || '', parent_action: parent_action || '',
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
