// utils/constants.ts — 全局常量与错误码映射

export const DURATION_ENUM = [15, 30, 45, 60, 75, 90, 105, 120];

export const SKIP_REASONS: SkipReason[] = ['没状态', '等待外部', '临时取消'];

// 治愈色系，系统自动分配
export const PROJECT_COLORS = [
  '#7A9E7E', '#E8B98A', '#A8C0D6', '#D6A8C0',
  '#C0D6A8', '#D6C7A8', '#A8D6CF', '#B8A8D6',
];

// 排期常量
export const BUFFER_RATIO = 0.8;         // 预留 20% 缓冲
export const FATIGUE_THRESHOLD = 90;     // 连续 ≥90min 触发治愈间隙
export const HEAL_GAP_DURATION = 10;     // 治愈间隙时长

// 超时阈值（毫秒）
export const TIMEOUT_AI = 20000;
export const TIMEOUT_NORMAL = 10000;
export const TIMEOUT_RESCHEDULE = 2000;

// 错误码 → 用户提示文案
export const ERROR_MESSAGES: Record<number, string> = {
  400: '登录信息无效，请重新登录',
  422: '没太理解，能再说清楚一点吗？',
  500: '服务开小差了，稍后再试',
  504: 'AI 在想，换个方式试试',
  0: '网络开小差了，请重试',
};

// 字段校验提示
export const FIELD_HINTS = {
  input_empty: '说点什么吧',
  duration: '请选择耗时',
  project_empty: '项目名不能为空',
  peak_hours: '请选择你的专注高峰',
  ideal_hours: '请设置每日工作时长',
  skip_reason: '请选择跳过原因',
};
