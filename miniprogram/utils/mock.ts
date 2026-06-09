// utils/mock.ts — 本地假数据，脱离云开发跑通完整流程
// 开关在 request.ts 的 USE_MOCK；上线接云函数时置 false 即可。

import { schedule } from './scheduler-lite';

// mock 内存态（仅本次会话）
const mem: {
  profileReady: boolean;
  tasks: any[];
  projects: Record<string, { project_id: string; name: string; color: string }>;
  skipStats: Record<string, number>;
  seq: number;
} = { profileReady: false, tasks: [], projects: {}, skipStats: {}, seq: 0 };

const COLORS = ['#7A9E7E', '#E8B98A', '#A8C0D6', '#D6A8C0', '#C0D6A8'];
const PROFILE = { ideal_work_hours: 6, peak_hours: ['09:00-11:00'] };

// 简易关键词 → 解析结果（替代 AI）
function fakeParse(text: string, allowSplit = false, forcePlan = false) {
  const t = text.trim();
  const tag = t.length > 6 ? t.slice(0, 4) : '日常';
  const dur = [15, 30, 45, 60][t.length % 4];
  const goal = t.slice(0, 100);
  const single = {
    is_big_task: false, action: goal, duration: dur, project_tag: tag,
    vision_statement: '', is_new_project: !mem.projects[tag], subtasks: [],
  };
  // 关闭拆解开关：永远单条
  if (!allowSplit && !forcePlan) return single;

  // 数量型：含「N 篇/个/次/章/集/章节」→ 按数量拆成 N 个独立单元
  const numMatch = t.match(/([0-9一二两三四五六七八九十]+)\s*(篇|个|条|次|章|集|份|节)/);
  const cnMap: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  let n = numMatch ? (Number(numMatch[1]) || cnMap[numMatch[1]] || 0) : 0;
  let unit = numMatch ? numMatch[2] : '个';
  // 模糊复数：几个/一些/多个/好几 → 估 3
  const vagueMatch = t.match(/(几|一些|多个|好几)\s*(个|篇|条|次|章|集|份|节)?/);
  if (!n && vagueMatch) { n = 3; unit = vagueMatch[2] || '个'; }
  if (n >= 2 && n <= 8) {
    const thing = (numMatch ? t.replace(numMatch[0], '') : t.replace(vagueMatch![0], ''))
      .replace(/^(发布|写|做|完成|发|剪|剪辑)/, '') || goal;
    return {
      is_big_task: true, action: goal, duration: nearestDurMock(n * 30), project_tag: tag,
      vision_statement: '一件一件来，做完就是赚到', is_new_project: !mem.projects[tag],
      subtasks: Array.from({ length: n }, (_, i) => ({
        action: `完成第${i + 1}${unit}：${thing.trim()}`, duration: 30,
      })),
    };
  }

  // 原子小事：短文本且无「项目/方案/上线」等大事词 → 不拆，诚实告知够小
  const bigWords = /(项目|方案|上线|筹备|系统|完整|策划|搭建|重构)/;
  if (t.length <= 8 && !bigWords.test(t)) {
    return { ...single, vision_statement: '' };
  }

  // 阶段型：拆成带具体产出物的步骤（mock 占位，线上由 AI 生成更贴合）
  return {
    is_big_task: true, action: goal, duration: 90, project_tag: tag,
    vision_statement: '迈出第一步，这件事就活了', is_new_project: !mem.projects[tag],
    subtasks: [
      { action: `列出「${goal}」要交付的具体内容清单`, duration: 30 },
      { action: `产出「${goal}」的第一版成品`, duration: 45 },
      { action: `打磨并交付「${goal}」`, duration: 30 },
    ],
  };
}
function nearestDurMock(d: number) {
  return [15, 30, 45, 60, 75, 90, 105, 120].reduce((p, c) => (Math.abs(c - d) < Math.abs(p - d) ? c : p), 60);
}

function delay<T>(data: T, ms = 300): Promise<T> {
  return new Promise((res) => setTimeout(() => res(data), ms));
}

// streak 推进指标（复刻 cloudfunctions/project_list 逻辑，供本地演示三态）
function cstDate(ms: number) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
// 自动徽章（复刻云函数 autoBadges）
function autoBadgesMock(mode: string, m: any) {
  const b: any[] = [];
  if (mode === 'streak') {
    const d = m.streak_days || 0;
    if (d >= 100) b.push({ key: 'streak_100', label: '坚持 100 天' });
    else if (d >= 30) b.push({ key: 'streak_30', label: '坚持 30 天' });
    else if (d >= 7) b.push({ key: 'streak_7', label: '坚持 7 天' });
  } else if (mode === 'result') {
    if (m.goal_target && (m.current_value || 0) >= m.goal_target) b.push({ key: 'goal_done', label: '达成目标 🎯' });
  } else {
    const c = m.completed_tasks || 0;
    if (m.goal_target && c >= m.goal_target) b.push({ key: 'goal_done', label: '达成目标 🎯' });
    if (c >= 100) b.push({ key: 'count_100', label: '完成 100 件' });
    else if (c >= 50) b.push({ key: 'count_50', label: '完成 50 件' });
    else if (c >= 10) b.push({ key: 'count_10', label: '完成 10 件' });
  }
  return b;
}
function weekStartMs() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const dow = (d.getUTCDay() + 6) % 7;
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow);
  return monday - 8 * 3600 * 1000;
}
// result 周期判断（复刻 cloudfunctions/project_record/period.js）
function periodStartMs(cycle: string) {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  if (cycle === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 8 * 3600 * 1000;
  if (cycle === 'week') {
    const dow = (d.getUTCDay() + 6) % 7;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow) - 8 * 3600 * 1000;
  }
  return 0;
}
function shouldReset(cycle: string, lastAt: number) {
  if (cycle !== 'month' && cycle !== 'week') return false;
  if (!lastAt) return false;
  return lastAt < periodStartMs(cycle);
}
function streakMetrics(doneList: any[], dailyQuota: number) {
  const quota = dailyQuota > 0 ? dailyQuota : 1;
  const byDay: Record<string, number> = {};
  doneList.forEach((t) => { if (t.finished_at) { const d = cstDate(t.finished_at); byDay[d] = (byDay[d] || 0) + 1; } });
  const metDays = Object.keys(byDay).filter((d) => byDay[d] >= quota).sort();
  const metSet = new Set(metDays);
  const oneDay = 86400 * 1000;
  let cursor = Date.now();
  if (!metSet.has(cstDate(cursor))) cursor -= oneDay;
  let streak = 0;
  while (metSet.has(cstDate(cursor))) { streak += 1; cursor -= oneDay; }
  const wkStart = weekStartMs();
  const weekMet = metDays.filter((d) => new Date(d + 'T00:00:00+08:00').getTime() >= wkStart).length;
  return { streak_days: streak, week_met_days: weekMet, total_done: doneList.length };
}

export function mockCall(name: string, data: any): Promise<any> {
  switch (name) {
    case 'auth_login':
      return delay({ token: 'mock_token', is_new_user: !mem.profileReady, user_id: 'u_mock' });

    case 'profile_init':
      mem.profileReady = true;
      return delay({ success: true });

    case 'profile_patch':
      return delay({ success: true, ...data });

    case 'task_parse':
      return delay(fakeParse(data.input_text, !!data.allow_split, !!data.force_plan), 600);

    case 'project_create': {
      const nm = (data.name || '').trim();
      if (mem.projects[nm]) {
        const ex = mem.projects[nm];
        return delay({ project_id: ex.project_id, name: ex.name, color: ex.color, mode: ex.mode, existed: true });
      }
      const idx = Object.keys(mem.projects).length;
      mem.projects[nm] = {
        project_id: `p_${idx}`, name: nm, color: COLORS[idx % COLORS.length],
        mode: data.mode || 'count',
        goal_target: Number(data.goal_target) || null,
        daily_quota: Number(data.daily_quota) || null,
        goal_unit: data.goal_unit || '',
        cycle: data.cycle || 'none',
        current_value: data.mode === 'result' ? 0 : null,
        current_value_at: 0,
      };
      return delay({ project_id: mem.projects[nm].project_id, name: nm, color: mem.projects[nm].color, mode: mem.projects[nm].mode, existed: false });
    }

    case 'task_save': {
      // 命中已有同名项目才归入；否则 project_id 留空（不自动建「随手记」）
      const tag = data.project_tag || '';
      const proj = tag ? mem.projects[tag] : null;
      const pid = proj ? proj.project_id : '';
      const today = cstDate(Date.now());
      const base = {
        project_id: pid, project_tag: proj ? tag : '',
        action: data.action, duration: data.duration, vision_statement: data.vision_statement,
        type: 'normal', scheduled_time: '', is_priority: !!data.is_priority, created_at: mem.seq,
      };
      if (data.repeat === 'daily') {
        // 母本（template，不排期不显示）+ 当天实例
        const tplId = `t_${++mem.seq}`;
        mem.tasks.push({ ...base, task_id: tplId, status: 'template', repeat: 'daily' });
        const instId = `t_${++mem.seq}`;
        mem.tasks.push({ ...base, task_id: instId, status: 'pending', repeat: 'none', repeat_parent_id: tplId, repeat_date: today });
        return delay({ task_id: instId, project_id: pid, template_id: tplId });
      }
      const task_id = `t_${++mem.seq}`;
      mem.tasks.push({ ...base, task_id, status: 'pending', repeat: 'none' });
      return delay({ task_id, project_id: pid });
    }

    case 'schedule_compute': {
      // daily_init：为每个每日重复母本补当天实例（缺则建），与云端一致
      if (data.trigger === 'daily_init') {
        const today = cstDate(Date.now());
        const haveToday = new Set(
          mem.tasks.filter((t) => t.repeat_date === today).map((t) => t.repeat_parent_id)
        );
        mem.tasks.filter((t) => t.status === 'template' && t.repeat === 'daily').forEach((tpl) => {
          if (haveToday.has(tpl.task_id)) return;
          mem.tasks.push({
            task_id: `t_${++mem.seq}`, project_id: tpl.project_id, project_tag: tpl.project_tag,
            action: tpl.action, duration: tpl.duration, vision_statement: tpl.vision_statement,
            type: 'normal', status: 'pending', scheduled_time: '', is_priority: !!tpl.is_priority,
            created_at: mem.seq, repeat: 'none', repeat_parent_id: tpl.task_id, repeat_date: today,
          });
        });
      }
      // 与云端一致：排除被移到次日的任务（scheduled_date 标记）；template 不参与排期
      const pending = mem.tasks.filter((t) => t.status === 'pending' && t.scheduled_date !== 'tomorrow');
      const r = schedule({ tasks: pending, profile: PROFILE, nowMinute: 540, skipStats: mem.skipStats });
      r.ordered_tasks.forEach((ot: any) => {
        const t = mem.tasks.find((x) => x.task_id === ot.task_id);
        if (t) t.scheduled_time = ot.scheduled_time;
      });
      const usedDone = mem.tasks.filter((t) => t.status === 'done')
        .reduce((s, t) => s + (t.actual_duration || t.duration), 0);
      const doneToday = mem.tasks.filter((t) => t.status === 'done').length;
      return delay({
        ordered_tasks: r.ordered_tasks,
        overflow_tasks: r.overflow_tasks,
        daily_capacity_used: usedDone + r.daily_capacity_used,
        daily_capacity_total: r.daily_capacity_total,
        done_today: doneToday,
      });
    }

    case 'task_complete': {
      const t = mem.tasks.find((x) => x.task_id === data.task_id);
      if (t) {
        t.status = data.result === 'complete' ? 'done' : 'skip';
        t.actual_duration = data.actual_duration || t.duration;
        if (data.result === 'complete') t.finished_at = Date.now();
        if (data.result === 'skip') {
          const bucket = (mem.skipStats[t.task_id] = mem.skipStats[t.task_id] || {});
          const reason = data.skip_reason || '临时取消';
          bucket[reason] = (bucket[reason] || 0) + 1;
        }
      }
      const next = mem.tasks.find((x) => x.status === 'pending');
      return delay({ success: true, next_task_id: next?.task_id || '' });
    }

    case 'task_defer': {
      const t = mem.tasks.find((x) => x.task_id === data.task_id);
      // 与云端一致：保持 pending，写次日标记，由 schedule_compute 的日期过滤排除出今日
      if (t) { t.scheduled_date = 'tomorrow'; t.scheduled_time = ''; }
      return delay({ deferred: !!t, scheduled_date: 'tomorrow' });
    }

    case 'task_delete': {
      mem.tasks = mem.tasks.filter((x) => x.task_id !== data.task_id);
      return delay({ deleted: true });
    }

    case 'project_record': {
      const proj: any = Object.values(mem.projects).find((p: any) => p.project_id === data.project_id);
      if (!proj || proj.mode !== 'result') return Promise.reject({ code: 422, msg: '只有数值型项目能记一笔' });
      const cycle = proj.cycle || 'none';
      const base = shouldReset(cycle, proj.current_value_at || 0) ? 0 : (proj.current_value || 0);
      proj.current_value = Math.round((base + Number(data.delta)) * 100) / 100;
      proj.current_value_at = Date.now();
      return delay({ project_id: proj.project_id, current_value: proj.current_value, current_value_at: proj.current_value_at });
    }

    case 'project_delete': {
      const proj = Object.values(mem.projects).find((p) => p.project_id === data.project_id);
      if (proj) {
        mem.tasks = mem.tasks.filter((x) => x.project_id !== data.project_id);
        delete mem.projects[proj.name];
      }
      return delay({ deleted: !!proj });
    }

    case 'review_week': {
      const wkStart = weekStartMs();
      const done = mem.tasks.filter((t) => t.status === 'done' && t.finished_at && t.finished_at >= wkStart);
      const skipsInWeek = mem.tasks.filter((t) => t.status === 'skip');
      // 按项目分布
      const nameOf: Record<string, string> = {}; const colorOf: Record<string, string> = {};
      Object.values(mem.projects).forEach((p: any) => { nameOf[p.project_id] = p.name; colorOf[p.project_id] = p.color; });
      const byProject: Record<string, number> = {};
      const minByProject: Record<string, number> = {};
      done.forEach((t) => {
        byProject[t.project_id || ''] = (byProject[t.project_id || ''] || 0) + 1;
        minByProject[t.project_id || ''] = (minByProject[t.project_id || ''] || 0) + (t.actual_duration || t.duration || 0);
      });
      const distribution = Object.keys(byProject).map((pid) => ({
        project_id: pid, name: nameOf[pid] || '零散', color: colorOf[pid] || '#B0AAA2', count: byProject[pid],
      })).sort((a, b) => b.count - a.count);
      const timeDistribution = Object.keys(minByProject).map((pid) => ({
        project_id: pid, name: nameOf[pid] || '零散', color: colorOf[pid] || '#B0AAA2', minutes: minByProject[pid],
      })).filter((d) => d.minutes > 0).sort((a, b) => b.minutes - a.minutes);
      // 跳过归因（mock 用 skipStats 累加的 reason 计数）
      const counts: any = { 没状态: 0, 等待外部: 0, 临时取消: 0 };
      Object.values(mem.skipStats).forEach((bucket: any) => {
        if (bucket && typeof bucket === 'object') {
          Object.keys(bucket).forEach((r) => { if (counts[r] !== undefined) counts[r] += bucket[r]; });
        }
      });
      const skipTotal = counts.没状态 + counts.等待外部 + counts.临时取消;
      // 耗时偏差
      let estSum = 0, actSum = 0, biasN = 0;
      done.forEach((t) => { const est = t.duration || 0; const act = t.actual_duration || 0; if (est && act) { estSum += est; actSum += act; biasN += 1; } });
      const ratio = estSum ? Math.round((actSum / estSum) * 10) / 10 : 0;
      // 今日小结
      const todayStart = new Date(cstDate(Date.now()) + 'T00:00:00+08:00').getTime();
      const todayDone = mem.tasks.filter((t) => t.status === 'done' && t.finished_at && t.finished_at >= todayStart);
      const todayMinutes = todayDone.reduce((s, t) => s + (t.actual_duration || t.duration || 0), 0);
      const todayActions = todayDone.sort((a, b) => (b.finished_at || 0) - (a.finished_at || 0)).slice(0, 5).map((t) => t.action || '一件事');
      const streakDays = todayDone.length ? 1 : 0; // mock 简化
      // 环比上周
      const lastWkStart = wkStart - 7 * 86400 * 1000;
      const lastWkDone = mem.tasks.filter((t) => t.status === 'done' && t.finished_at && t.finished_at >= lastWkStart && t.finished_at < wkStart);
      return delay({
        week_start: wkStart, done_count: done.length, distribution, time_distribution: timeDistribution, top_project: distribution[0] || null,
        skip_counts: counts, skip_total: skipTotal,
        duration_bias: { sample: biasN, est_minutes: estSum, act_minutes: actSum, ratio },
        today: { done_count: todayDone.length, minutes: todayMinutes, actions: todayActions, streak_days: streakDays },
        compare: { last_done: lastWkDone.length, done_delta: done.length - lastWkDone.length, last_skip: 0, skip_delta: skipTotal },
      });
    }

    case 'project_list': {
      const projects = Object.values(mem.projects).map((p: any) => {
        const taskList = mem.tasks.filter((t) => t.project_id === p.project_id && t.status !== 'template');
        const list = taskList.map((t) => ({ task_id: t.task_id, action: t.action, status: t.status }));
        const doneList = taskList.filter((t) => t.status === 'done');
        const mode = p.mode || 'count';
        const base = {
          project_id: p.project_id, name: p.name, color: p.color,
          mode,
          goal_target: p.goal_target || null,
          daily_quota: p.daily_quota || null,
          goal_unit: p.goal_unit || '',
          cycle: p.cycle || 'none',
          current_value: shouldReset(p.cycle || 'none', p.current_value_at || 0) ? 0 : (p.current_value || 0),
          total_tasks: list.length,
          completed_tasks: doneList.length,
          tasks: list,
          achievements: p.achievements || [],
        };
        if (mode === 'streak') {
          const m = { ...base, ...streakMetrics(doneList, p.daily_quota) };
          return { ...m, auto_badges: autoBadgesMock('streak', m) };
        }
        return { ...base, auto_badges: autoBadgesMock(mode, base) };
      });
      return delay({ projects });
    }

    case 'project_achievement': {
      const p: any = Object.values(mem.projects).find((x: any) => x.project_id === data.project_id);
      if (!p) return Promise.reject({ code: 404, msg: '项目不存在' });
      p.achievements = p.achievements || [];
      if (data.action === 'add') {
        const ach = { ach_id: `a_${++mem.seq}`, text: String(data.text || '').trim(), created_at: Date.now() };
        p.achievements.push(ach);
        return delay({ achievement: ach });
      }
      if (data.action === 'delete') {
        p.achievements = p.achievements.filter((a: any) => a.ach_id !== data.ach_id);
        return delay({ deleted: true });
      }
      return Promise.reject({ code: 422, msg: '未知操作' });
    }

    default:
      return Promise.reject({ code: 500, msg: 'mock 未实现: ' + name });
  }
}
