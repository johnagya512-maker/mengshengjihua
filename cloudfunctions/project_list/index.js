// cloudfunctions/project_list/index.js — 项目圆环列表
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

// 东八区日期 YYYY-MM-DD
function cstDate(ms) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
// 本周一 0 点的时间戳（东八区），用于「本周达标」统计
function weekStartMs() {
  const now = Date.now();
  const d = new Date(now + 8 * 3600 * 1000);
  const dow = (d.getUTCDay() + 6) % 7; // 周一=0
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow);
  return monday - 8 * 3600 * 1000;
}

// result 周期起点：跨周期(月/周)且上次记录在本周期前 → 展示值归零（与 project_record/period 一致）
function effectiveValue(cycle, currentValue, lastAt) {
  if (cycle !== 'month' && cycle !== 'week') return currentValue || 0;
  if (!lastAt) return currentValue || 0;
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  let start;
  if (cycle === 'month') start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 8 * 3600 * 1000;
  else { const dow = (d.getUTCDay() + 6) % 7; start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow) - 8 * 3600 * 1000; }
  return lastAt < start ? 0 : (currentValue || 0);
}

// streak 推进指标：连续达标天数 / 本周达标天数 / 累计完成件数
// daily_quota = 每日标准件数（如日更1个）。当天完成数 >= quota 即「达标」。
function streakMetrics(doneList, dailyQuota) {
  const quota = dailyQuota > 0 ? dailyQuota : 1;
  const byDay = {};
  doneList.forEach((t) => {
    if (!t.finished_at) return;
    const day = cstDate(t.finished_at);
    byDay[day] = (byDay[day] || 0) + 1;
  });
  const metDays = Object.keys(byDay).filter((d) => byDay[d] >= quota).sort(); // 达标日，升序
  // 连续达标天数：从今天或昨天往前数连续达标的天
  let streak = 0;
  const oneDay = 86400 * 1000;
  let cursor = Date.now();
  const todayStr = cstDate(cursor);
  const metSet = new Set(metDays);
  // 今天没达标不立刻断（还没过完），从今天起：今天达标算1，否则从昨天起算
  if (!metSet.has(todayStr)) cursor -= oneDay;
  while (metSet.has(cstDate(cursor))) { streak += 1; cursor -= oneDay; }
  // 本周达标天数
  const wkStart = weekStartMs();
  const weekMet = metDays.filter((d) => new Date(d + 'T00:00:00+08:00').getTime() >= wkStart).length;
  return { streak_days: streak, week_met_days: weekMet, total_done: doneList.length };
}

// 自动徽章：按现有数据动态算，不存库
// streak: 连续达标 ≥7/30/100 天；count: 完成数跨 10/50/100 件或达成目标；result: 进度≥100%
function autoBadges(mode, metrics) {
  const badges = [];
  if (mode === 'streak') {
    const d = metrics.streak_days || 0;
    if (d >= 100) badges.push({ key: 'streak_100', label: '坚持 100 天' });
    else if (d >= 30) badges.push({ key: 'streak_30', label: '坚持 30 天' });
    else if (d >= 7) badges.push({ key: 'streak_7', label: '坚持 7 天' });
  } else if (mode === 'result') {
    if (metrics.goal_target && (metrics.current_value || 0) >= metrics.goal_target) {
      badges.push({ key: 'goal_done', label: '达成目标 🎯' });
    }
  } else {
    const c = metrics.completed_tasks || 0;
    if (metrics.goal_target && c >= metrics.goal_target) badges.push({ key: 'goal_done', label: '达成目标 🎯' });
    if (c >= 100) badges.push({ key: 'count_100', label: '完成 100 件' });
    else if (c >= 50) badges.push({ key: 'count_50', label: '完成 50 件' });
    else if (c >= 10) badges.push({ key: 'count_10', label: '完成 10 件' });
  }
  return badges;
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail(400, '登录态无效');

  try {
    const projRes = await db.collection('projects').where({ _openid: OPENID }).get();
    const taskRes = await db.collection('tasks')
      .where({ _openid: OPENID })
      .field({ task_id: true, action: true, status: true, project_id: true, parent_task_id: true, parent_action: true, finished_at: true, from_project: true })
      .get();

    const tasksByProject = {};
    taskRes.data.forEach((t) => {
      if (t.status === 'template') return; // 每日重复母本：不计入任务点/统计，只用于实例化
      if (!t.from_project) return; // 完全解耦：只认项目内自建任务，今日清单/AI 拆解的不倒灌进项目
      (tasksByProject[t.project_id] = tasksByProject[t.project_id] || []).push({
        task_id: t.task_id, action: t.action, status: t.status,
        parent_task_id: t.parent_task_id || '', parent_action: t.parent_action || '',
        finished_at: t.finished_at || 0,
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
      const doneList = list.filter((t) => t.status === 'done');
      const completed = doneList.length;
      const mode = p.mode || 'count';
      const base = {
        project_id: p.project_id,
        name: p.name,
        color: p.color,
        mode,
        goal_target: p.goal_target || null,
        daily_quota: p.daily_quota || null,
        goal_unit: p.goal_unit || '',
        cycle: p.cycle || 'none',
        current_value: effectiveValue(p.cycle || 'none', p.current_value, p.current_value_at),
        total_tasks: list.length,
        completed_tasks: completed,
        groups: groupByParent(list),
        tasks: list,
        achievements: p.achievements || [],
      };
      if (mode === 'streak') {
        const m = { ...base, ...streakMetrics(doneList, p.daily_quota) };
        return { ...m, auto_badges: autoBadges('streak', m) };
      }
      return { ...base, auto_badges: autoBadges(mode, base) };
    });

    return ok({ projects });
  } catch (e) {
    console.error('project_list 失败:', e);
    return fail(500, '加载失败，请重试');
  }
};
