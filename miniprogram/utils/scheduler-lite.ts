// utils/scheduler-lite.ts — 前端排期算法（与云函数 scheduler.js 同逻辑，供 mock 使用）

const BUFFER_RATIO = 0.8;

function parseRange(range: string): [number, number] {
  const [s, e] = range.split('-');
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  return [toMin(s), toMin(e)];
}
function inPeak(min: number, ranges: [number, number][]): boolean {
  return ranges.some(([s, e]) => min >= s && min < e);
}
function minToHHmm(min: number): string {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function dailyCapacity(ideal: number): number {
  return Math.round(ideal * 60 * BUFFER_RATIO);
}

// 跳过归因权重（规则5）：没状态=回避→往后压；临时取消=中性；等待外部=环境阻塞→不惩罚
const SKIP_WEIGHTS: Record<string, number> = { 没状态: 1, 临时取消: 0.5, 等待外部: 0 };
function skipScore(entry: number | Record<string, number> | undefined): number {
  if (entry == null) return 0;
  if (typeof entry === 'number') return entry; // 旧版：原始计数
  return Object.keys(entry).reduce((sum, reason) => {
    const w = SKIP_WEIGHTS[reason] !== undefined ? SKIP_WEIGHTS[reason] : 1;
    return sum + w * (entry[reason] || 0);
  }, 0);
}

// 应用隐形学习的耗时偏差校正（规则3），与云端 scheduler.js 保持一致。
// duration_bias 是全局系数（实际/预估中位值），有则放大/缩小预估耗时，无则原样返回。
function biasedDuration(task: any, durationBias: number | null): number {
  const raw = task.duration || 30;
  if (!durationBias) return raw;
  return Math.round(raw * durationBias);
}

const MINUTES_IN_DAY = 24 * 60;

interface SchedInput {
  tasks: any[];
  profile: { peak_hours?: string[]; ideal_work_hours?: number; focus_tolerance?: number; duration_bias?: number };
  nowMinute?: number;
  skipStats?: Record<string, number | Record<string, number>>;
  usedMinutes?: number; // 今日已完成时长，从可用容量中先扣除
}

export function schedule(ctx: SchedInput) {
  const { tasks = [], profile = {}, nowMinute = 540, skipStats = {}, usedMinutes = 0 } = ctx;
  const peakRanges = (profile.peak_hours || []).map(parseRange);
  const capacityTotal = dailyCapacity(profile.ideal_work_hours || 6);
  const durationBias = profile.duration_bias || null;
  // 待办可用容量 = 总容量 - 今日已完成，避免与已完成时长重复计账
  const available = Math.max(0, capacityTotal - usedMinutes);

  const sorted = [...tasks].sort((a, b) => {
    if (!!b.is_priority !== !!a.is_priority) return b.is_priority ? 1 : -1;
    const sa = skipScore(skipStats[a.task_id]), sb = skipScore(skipStats[b.task_id]);
    if (sa !== sb) return sa - sb;
    return (a.created_at || 0) - (b.created_at || 0);
  });

  const ordered: any[] = [];
  const overflow: any[] = [];
  let cursor = nowMinute, used = 0;

  for (const t of sorted) {
    const dur = biasedDuration(t, durationBias);
    // 容量已满，或排到此任务会越过午夜 → 溢出，不静默回绕到次日凌晨
    if (used + dur > available || cursor + dur > MINUTES_IN_DAY) {
      overflow.push({ ...t, reason: 'capacity_full' });
      continue;
    }
    ordered.push({ ...t, type: 'normal', scheduled_time: minToHHmm(cursor), in_peak: inPeak(cursor, peakRanges) });
    cursor += dur; used += dur;
  }
  return { ordered_tasks: ordered, overflow_tasks: overflow, daily_capacity_used: used, daily_capacity_total: capacityTotal };
}
