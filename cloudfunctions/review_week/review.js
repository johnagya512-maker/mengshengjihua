// cloudfunctions/review_week/review.js — 复盘聚合纯函数（可独立测试）
// 方向 v1.1 §4：只把已有数据呈现出来，不新增埋点。陈述事实 + 轻量建议，不评判。

const DAY_MS = 86400 * 1000;

// 本周一 0 点（东八区）时间戳
function weekStartMs(nowMs) {
  const d = new Date(nowMs + 8 * 3600 * 1000);
  const dow = (d.getUTCDay() + 6) % 7; // 周一=0
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow);
  return monday - 8 * 3600 * 1000;
}

// 今日 0 点（东八区）时间戳
function todayStartMs(nowMs) {
  const d = new Date(nowMs + 8 * 3600 * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 8 * 3600 * 1000;
}

// 本月 1 号 0 点（东八区）时间戳
function monthStartMs(nowMs) {
  const d = new Date(nowMs + 8 * 3600 * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 8 * 3600 * 1000;
}

// 本年 1 月 1 号 0 点（东八区）时间戳
function yearStartMs(nowMs) {
  const d = new Date(nowMs + 8 * 3600 * 1000);
  return Date.UTC(d.getUTCFullYear(), 0, 1) - 8 * 3600 * 1000;
}

// 上一个同长度周期的起点（用于环比）：week→上周, month→上月, year→去年
function prevPeriodStartMs(period, curStart) {
  const d = new Date(curStart + 8 * 3600 * 1000);
  if (period === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1) - 8 * 3600 * 1000;
  if (period === 'year') return Date.UTC(d.getUTCFullYear() - 1, 0, 1) - 8 * 3600 * 1000;
  return curStart - 7 * DAY_MS; // week
}

// 区间起点：按 period 返回当前周期起点；lifetime 返回 0（全量）
function periodStartMs(period, nowMs) {
  if (period === 'month') return monthStartMs(nowMs);
  if (period === 'year') return yearStartMs(nowMs);
  if (period === 'lifetime') return 0;
  return weekStartMs(nowMs);
}

// 东八区日期串 YYYY-MM-DD
function cstDate(ms) {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 连续行动天数：从今天（或昨天）往前数，有完成记录的连续天数
function actionStreak(doneTasks, nowMs) {
  const days = new Set(doneTasks.filter((t) => t.finished_at).map((t) => cstDate(t.finished_at)));
  let streak = 0;
  let cursor = nowMs;
  if (!days.has(cstDate(cursor))) cursor -= DAY_MS; // 今天还没做不立刻断
  while (days.has(cstDate(cursor))) { streak += 1; cursor -= DAY_MS; }
  return streak;
}

function round1(n) { return Math.round(n * 10) / 10; }

// 生涯累计：从第一条完成记录算起，永不归零
// 总完成件数 / 总专注分钟 / 累计行动天数(有完成记录的不同天数) / 最长连续天数 / 起始日
function lifetimeStats(doneTasks, nowMs) {
  const done = doneTasks.filter((t) => t.finished_at);
  const totalDone = done.length;
  const totalMinutes = done.reduce((s, t) => s + (t.actual_duration || t.duration || 0), 0);
  const dayset = new Set(done.map((t) => cstDate(t.finished_at)));
  const activeDays = dayset.size;
  // 最长连续天数：把行动日排序，扫描最长连续段
  const days = Array.from(dayset).sort();
  let longest = 0, run = 0, prevMs = null;
  days.forEach((ds) => {
    const ms = new Date(ds + 'T00:00:00+08:00').getTime();
    if (prevMs !== null && ms - prevMs === DAY_MS) run += 1;
    else run = 1;
    if (run > longest) longest = run;
    prevMs = ms;
  });
  // 起始日：第一条完成记录的日期
  let firstDay = '';
  if (done.length) {
    const minMs = done.reduce((m, t) => Math.min(m, t.finished_at), done[0].finished_at);
    firstDay = cstDate(minMs);
  }
  return {
    total_done: totalDone,
    total_minutes: totalMinutes,
    active_days: activeDays,
    longest_streak: longest,
    current_streak: actionStreak(doneTasks, nowMs),
    first_day: firstDay,
  };
}

// 年度按月趋势：返回 12 个月每月的完成件数与专注分钟（当年）
function monthlyTrend(doneTasks, nowMs) {
  const d = new Date(nowMs + 8 * 3600 * 1000);
  const year = d.getUTCFullYear();
  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: 0, minutes: 0 }));
  doneTasks.forEach((t) => {
    if (!t.finished_at) return;
    const dd = new Date(t.finished_at + 8 * 3600 * 1000);
    if (dd.getUTCFullYear() !== year) return;
    const m = dd.getUTCMonth();
    months[m].count += 1;
    months[m].minutes += (t.actual_duration || t.duration || 0);
  });
  return months;
}

// 区间聚合：完成分布（按项目）/ 跳过归因 / 耗时偏差，区间由 period 决定
// period: 'week'(默认) | 'month' | 'year' | 'lifetime'
// doneTasks: [{project_id, action, actual_duration, duration, finished_at}]
// skipLogs:  [{skip_reason, created_at}]
// projects:  [{project_id, name, color}]
function review({ doneTasks = [], skipLogs = [], projects = [], nowMs, period = 'week' }) {
  const wkStart = periodStartMs(period, nowMs);
  const done = doneTasks.filter((t) => t.finished_at && t.finished_at >= wkStart);
  const skips = skipLogs.filter((s) => s.created_at && s.created_at >= wkStart);

  // 1) 本周做了啥：完成总数 + 按项目分布
  const nameOf = {};
  const colorOf = {};
  projects.forEach((p) => { nameOf[p.project_id] = p.name; colorOf[p.project_id] = p.color; });
  const byProject = {};
  const minutesByProject = {};
  done.forEach((t) => {
    const pid = t.project_id || '';
    byProject[pid] = (byProject[pid] || 0) + 1;
    minutesByProject[pid] = (minutesByProject[pid] || 0) + (t.actual_duration || t.duration || 0);
  });
  const distribution = Object.keys(byProject)
    .map((pid) => ({
      project_id: pid,
      name: nameOf[pid] || '零散',
      color: colorOf[pid] || '#B0AAA2',
      count: byProject[pid],
    }))
    .sort((a, b) => b.count - a.count);
  // 时间花费分布：按项目累计实际耗时（分钟），降序
  const timeDistribution = Object.keys(minutesByProject)
    .map((pid) => ({
      project_id: pid,
      name: nameOf[pid] || '零散',
      color: colorOf[pid] || '#B0AAA2',
      minutes: minutesByProject[pid],
    }))
    .filter((d) => d.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  // 2) 跳过归因：哪类偏多
  const counts = { 没状态: 0, 等待外部: 0, 临时取消: 0 };
  skips.forEach((s) => { if (counts[s.skip_reason] !== undefined) counts[s.skip_reason] += 1; });
  const skipTotal = counts.没状态 + counts.等待外部 + counts.临时取消;

  // 3) 耗时认知：实际 vs 预估（只统计两者都有的）
  let estSum = 0, actSum = 0, biasN = 0;
  done.forEach((t) => {
    const est = t.duration || 0;
    const act = t.actual_duration || 0;
    if (est && act) { estSum += est; actSum += act; biasN += 1; }
  });
  const biasRatio = estSum ? round1(actSum / estSum) : 0; // >1 习惯性低估，<1 习惯性高估

  // 4) 今日小结（激励向，只取当天）
  const todayStart = todayStartMs(nowMs);
  const todayDone = doneTasks.filter((t) => t.finished_at && t.finished_at >= todayStart);
  const todayMinutes = todayDone.reduce((s, t) => s + (t.actual_duration || t.duration || 0), 0);
  const todayActions = todayDone
    .sort((a, b) => (b.finished_at || 0) - (a.finished_at || 0))
    .slice(0, 5)
    .map((t) => t.action || '一件事');
  const today = {
    done_count: todayDone.length,
    minutes: todayMinutes,
    actions: todayActions,
    streak_days: actionStreak(doneTasks, nowMs),
  };

  // 5) 环比上一周期：完成数 / 跳过数 的差值（同口径=上一个同长度周期）
  const lastWkStart = prevPeriodStartMs(period, wkStart);
  const lastWkDone = doneTasks.filter((t) => t.finished_at && t.finished_at >= lastWkStart && t.finished_at < wkStart);
  const lastWkSkip = skipLogs.filter((s) => s.created_at && s.created_at >= lastWkStart && s.created_at < wkStart);
  const compare = {
    last_done: lastWkDone.length,
    done_delta: done.length - lastWkDone.length,
    last_skip: lastWkSkip.length,
    skip_delta: skipTotal - lastWkSkip.length,
  };

  return {
    period,
    week_start: wkStart,
    done_count: done.length,
    distribution,
    time_distribution: timeDistribution,
    top_project: distribution[0] || null,
    skip_counts: counts,
    skip_total: skipTotal,
    duration_bias: { sample: biasN, est_minutes: estSum, act_minutes: actSum, ratio: biasRatio },
    today,
    compare,
    lifetime: lifetimeStats(doneTasks, nowMs), // 生涯累计：所有视图都带，前端常驻展示
    monthly_trend: period === 'year' ? monthlyTrend(doneTasks, nowMs) : null, // 年度视图才算趋势
  };
}

module.exports = { review, weekStartMs, todayStartMs, monthStartMs, yearStartMs, actionStreak, lifetimeStats };
