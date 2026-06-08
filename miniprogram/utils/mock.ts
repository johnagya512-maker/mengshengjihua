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

export function mockCall(name: string, data: any): Promise<any> {
  switch (name) {
    case 'auth_login':
      return delay({ token: 'mock_token', is_new_user: !mem.profileReady, user_id: 'u_mock' });

    case 'profile_init':
      mem.profileReady = true;
      return delay({ success: true });

    case 'task_parse':
      return delay(fakeParse(data.input_text), 600);

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

    case 'project_list': {
      const projects = Object.values(mem.projects).map((p) => {
        const list = mem.tasks.filter((t) => t.project_id === p.project_id)
          .map((t) => ({ task_id: t.task_id, action: t.action, status: t.status }));
        return {
          ...p, total_tasks: list.length,
          completed_tasks: list.filter((t) => t.status === 'done').length, tasks: list,
        };
      });
      return delay({ projects });
    }

    default:
      return Promise.reject({ code: 500, msg: 'mock 未实现: ' + name });
  }
}
