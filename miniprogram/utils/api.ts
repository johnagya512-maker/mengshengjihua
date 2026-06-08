// utils/api.ts — 业务接口封装（对应 7 个云函数）
import { callCloud } from './request';

export interface LoginResult { token: string; is_new_user: boolean; user_id: string; }
export interface ScheduleResult {
  ordered_tasks: Task[];
  overflow_tasks: Task[];
  daily_capacity_used: number;
  daily_capacity_total: number;
  done_today: number;
}

export const api = {
  // 登录：wx.login 拿 code 后由云函数自动取 openid（云开发免传 code）
  login(): Promise<LoginResult> {
    return callCloud<LoginResult>('auth_login', {}, { silent: true });
  },

  initProfile(p: UserProfile & { user_id: string }): Promise<{ success: boolean }> {
    return callCloud('profile_init', p);
  },

  parseTask(input_text: string, allow_split = false, force_plan = false): Promise<ParseResult> {
    return callCloud<ParseResult>('task_parse', { input_text, allow_split, force_plan }, { isAI: true });
  },

  saveTask(t: Partial<Task>): Promise<{ task_id: string; project_id: string }> {
    return callCloud('task_save', t);
  },

  compute(trigger: ScheduleTrigger, task_id?: string): Promise<ScheduleResult> {
    return callCloud<ScheduleResult>('schedule_compute', { trigger, task_id });
  },

  completeTask(p: { task_id: string; actual_duration: number; result: 'complete' | 'skip'; skip_reason?: SkipReason; }):
    Promise<{ success: boolean; next_task_id: string }> {
    return callCloud('task_complete', p);
  },

  deleteTask(task_id: string): Promise<{ deleted: boolean }> {
    return callCloud('task_delete', { task_id });
  },

  // 容量饱和：把任务移到次日队列（跨天后自动回归今日）
  deferTask(task_id: string): Promise<{ deferred: boolean; scheduled_date: string }> {
    return callCloud('task_defer', { task_id });
  },

  listProjects(): Promise<{ projects: Project[] }> {
    return callCloud('project_list');
  },

  createProject(name: string): Promise<{ project_id: string; name: string; color: string; existed: boolean }> {
    return callCloud('project_create', { name });
  },

  deleteProject(project_id: string): Promise<{ deleted: boolean }> {
    return callCloud('project_delete', { project_id });
  },
};
