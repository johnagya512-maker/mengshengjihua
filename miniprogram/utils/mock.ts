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
function fakeParse(text: string) {
  const t = text.trim();
  const tag = t.length > 6 ? t.slice(0, 4) : '日常';
  const dur = [15, 30, 45, 60][t.length % 4];
  return {
    action: t.slice(0, 100),
    duration: dur,
    project_tag: tag,
    vision_statement: '迈出这一步，项目就活了',
    is_new_project: !mem.projects[tag],
  };
}

function delay<T>(data: T, ms = 300): Promise<T> {
  return new Promise((res) => setTimeout(() => res(data), ms));
}

// streak 推进指标（复刻 cloudfunctions/project_list 逻辑，供本地演示三态）
function cstDate(ms: number) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function weekStartMs() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const dow = (d.getUTCDay() + 6) % 7;
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow);
  return monday - 8 * 3600 * 1000;
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

    case 'task_parse':
      return delay(fakeParse(data.input_text), 600);

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
      };
      return delay({ project_id: mem.projects[nm].project_id, name: nm, color: mem.projects[nm].color, mode: mem.projects[nm].mode, existed: false });
    }

    case 'task_save': {
      const tag = data.project_tag || '日常';
      if (!mem.projects[tag]) {
        const idx = Object.keys(mem.projects).length;
        mem.projects[tag] = { project_id: `p_${idx}`, name: tag, color: COLORS[idx % COLORS.length] };
      }
      const task_id = `t_${++mem.seq}`;
      mem.tasks.push({
        task_id, project_id: mem.projects[tag].project_id, project_tag: tag,
        action: data.action, duration: data.duration, vision_statement: data.vision_statement,
        type: 'normal', status: 'pending', scheduled_time: '', is_priority: !!data.is_priority,
        created_at: mem.seq,
      });
      return delay({ task_id, project_id: mem.projects[tag].project_id });
    }

    case 'schedule_compute': {
      // 与云端一致：排除被移到次日的任务（scheduled_date 标记）
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
      done.forEach((t) => { byProject[t.project_id || ''] = (byProject[t.project_id || ''] || 0) + 1; });
      const distribution = Object.keys(byProject).map((pid) => ({
        project_id: pid, name: nameOf[pid] || '随手记', color: colorOf[pid] || '#B0AAA2', count: byProject[pid],
      })).sort((a, b) => b.count - a.count);
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
      return delay({
        week_start: wkStart, done_count: done.length, distribution, top_project: distribution[0] || null,
        skip_counts: counts, skip_total: skipTotal,
        duration_bias: { sample: biasN, est_minutes: estSum, act_minutes: actSum, ratio },
      });
    }

    case 'project_list': {
      const projects = Object.values(mem.projects).map((p: any) => {
        const taskList = mem.tasks.filter((t) => t.project_id === p.project_id);
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
          current_value: p.current_value || 0,
          total_tasks: list.length,
          completed_tasks: doneList.length,
          tasks: list,
        };
        if (mode === 'streak') return { ...base, ...streakMetrics(doneList, p.daily_quota) };
        return base;
      });
      return delay({ projects });
    }

    default:
      return Promise.reject({ code: 500, msg: 'mock 未实现: ' + name });
  }
}
