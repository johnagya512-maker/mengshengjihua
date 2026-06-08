// typings/index.d.ts — 全局类型声明

interface IAppOption {
  globalData: {
    userId: string;
    isNewUser: boolean;
    profileReady: boolean;
  };
}

// ===== 领域模型 =====
type TaskStatus = 'pending' | 'done' | 'skip';
type TaskType = 'normal' | 'gap'; // gap = 治愈间隙
type SkipReason = '没状态' | '等待外部' | '临时取消';
type ScheduleTrigger = 'add_task' | 'complete' | 'skip' | 'daily_init';

interface UserProfile {
  peak_hours: string[];        // ["09:00-11:00"]，由作息推导
  focus_tolerance?: number;    // 单次专注耐受（分钟），决定治愈间隙节奏
  pain_task_types: string[];
  ideal_work_hours: number;    // 1~12, step 0.5
}

interface Task {
  task_id: string;
  user_id: string;
  project_id: string;
  project_tag: string;
  action: string;
  duration: number;            // 分钟, 枚举 15/30/.../120
  vision_statement: string;
  type: TaskType;
  status: TaskStatus;
  scheduled_time: string;      // ISO 或 HH:mm
  actual_duration?: number;
  skip_reason?: SkipReason;
  is_priority?: boolean;       // P0 紧急
  parent_task_id?: string;     // 大事拆分：所属父任务（步骤共享同一个）
  parent_action?: string;      // 父任务（大事）标题，用于归组显示
  created_at: number;
}

interface Project {
  project_id: string;
  name: string;
  color: string;               // HEX
  total_tasks: number;
  completed_tasks: number;
  tasks?: Array<{ task_id: string; action: string; status: TaskStatus }>;
}

interface SubTask {
  action: string;
  duration: number;
}

interface ParseResult {
  is_big_task: boolean;
  action: string;
  duration: number;
  project_tag: string;
  vision_statement: string;
  is_new_project: boolean;
  subtasks: SubTask[];
}
