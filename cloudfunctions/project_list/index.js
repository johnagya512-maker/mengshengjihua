// cloudfunctions/project_list/index.js — 项目圆环列表
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail(400, '登录态无效');

  try {
    const projRes = await db.collection('projects').where({ _openid: OPENID }).get();
    const taskRes = await db.collection('tasks')
      .where({ _openid: OPENID })
      .field({ task_id: true, action: true, status: true, project_id: true, parent_task_id: true, parent_action: true })
      .get();

    const tasksByProject = {};
    taskRes.data.forEach((t) => {
      (tasksByProject[t.project_id] = tasksByProject[t.project_id] || []).push({
        task_id: t.task_id, action: t.action, status: t.status,
        parent_task_id: t.parent_task_id || '', parent_action: t.parent_action || '',
      });
    });

    // 把同一父任务（大事）的步骤归到一组；独立任务各自成组
    function groupByParent(list) {
      const groups = [];
      const byParent = {};
      list.forEach((t) => {
        if (t.parent_task_id) {
          if (!byParent[t.parent_task_id]) {
            byParent[t.parent_task_id] = { is_group: true, parent_action: t.parent_action, steps: [] };
            groups.push(byParent[t.parent_task_id]);
          }
          byParent[t.parent_task_id].steps.push(t);
        } else {
          groups.push({ is_group: false, ...t });
        }
      });
      return groups;
    }

    const projects = projRes.data.map((p) => {
      const list = tasksByProject[p.project_id] || [];
      const completed = list.filter((t) => t.status === 'done').length;
      return {
        project_id: p.project_id,
        name: p.name,
        color: p.color,
        total_tasks: list.length,
        completed_tasks: completed,
        groups: groupByParent(list),
        tasks: list,
      };
    });

    return ok({ projects });
  } catch (e) {
    return fail(500, '加载失败: ' + e.message);
  }
};
