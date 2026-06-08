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
type ProjectMode = 'count' | 'streak' | 'result'; // 项目三态：计数/坚持/数值
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
  scheduled_date?: string;     // YYYY-MM-DD，被移到次日时写入；空=今日队列
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
  // ===== v1.1 项目三态 =====
  mode?: ProjectMode;          // count / streak / result，默认 count
  goal_target?: number | null; // count=目标件数；result=目标数值
  daily_quota?: number | null; // streak 每日标准（如日更 1 个）
  goal_unit?: string;          // result 单位（元/粉丝）
  cycle?: 'month' | 'week' | 'none';
  current_value?: number;      // result 当前值
  // streak 推进指标（project_list 现算）
  streak_days?: number;        // 连续达标天数
  week_met_days?: number;      // 本周达标天数
  total_done?: number;         // 累计完成件数
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
