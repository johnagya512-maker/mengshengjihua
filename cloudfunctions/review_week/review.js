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

function round1(n) { return Math.round(n * 10) / 10; }

// 本周聚合：完成分布（按项目）/ 跳过归因 / 耗时偏差
// doneTasks: [{project_id, actual_duration, duration, finished_at}]
// skipLogs:  [{skip_reason, created_at}]
// projects:  [{project_id, name, color}]
function review({ doneTasks = [], skipLogs = [], projects = [], nowMs }) {
  const wkStart = weekStartMs(nowMs);
  const done = doneTasks.filter((t) => t.finished_at && t.finished_at >= wkStart);
  const skips = skipLogs.filter((s) => s.created_at && s.created_at >= wkStart);

  // 1) 本周做了啥：完成总数 + 按项目分布
  const nameOf = {};
  const colorOf = {};
  projects.forEach((p) => { nameOf[p.project_id] = p.name; colorOf[p.project_id] = p.color; });
  const byProject = {};
  done.forEach((t) => {
    const pid = t.project_id || '';
    byProject[pid] = (byProject[pid] || 0) + 1;
  });
  const distribution = Object.keys(byProject)
    .map((pid) => ({
      project_id: pid,
      name: nameOf[pid] || '零散',
      color: colorOf[pid] || '#B0AAA2',
      count: byProject[pid],
    }))
    .sort((a, b) => b.count - a.count);

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

  return {
    week_start: wkStart,
    done_count: done.length,
    distribution,
    top_project: distribution[0] || null,
    skip_counts: counts,
    skip_total: skipTotal,
    duration_bias: { sample: biasN, est_minutes: estSum, act_minutes: actSum, ratio: biasRatio },
  };
}

module.exports = { review, weekStartMs };
