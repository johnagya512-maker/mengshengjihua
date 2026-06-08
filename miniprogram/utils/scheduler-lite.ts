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

interface SchedInput {
  tasks: any[];
  profile: { peak_hours?: string[]; ideal_work_hours?: number; focus_tolerance?: number; duration_bias?: number };
  nowMinute?: number;
  skipStats?: Record<string, number | Record<string, number>>;
}

export function schedule(ctx: SchedInput) {
  const { tasks = [], profile = {}, nowMinute = 540, skipStats = {} } = ctx;
  const peakRanges = (profile.peak_hours || []).map(parseRange);
  const capacityTotal = dailyCapacity(profile.ideal_work_hours || 6);
  // 治愈间隙阈值：优先用用户单次专注耐受，未设置回退默认（与云端 scheduler.js 一致）
  const fatigueThreshold = profile.focus_tolerance || FATIGUE_THRESHOLD;

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
    const dur = t.duration || 30;
    if (used + dur > capacityTotal) { overflow.push({ ...t, reason: 'capacity_full' }); continue; }
    ordered.push({ ...t, type: 'normal', scheduled_time: minToHHmm(cursor), in_peak: inPeak(cursor, peakRanges) });
    cursor += dur; used += dur;
  }
  return { ordered_tasks: ordered, overflow_tasks: overflow, daily_capacity_used: used, daily_capacity_total: capacityTotal };
}
