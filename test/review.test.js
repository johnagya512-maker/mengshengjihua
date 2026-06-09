// 复盘聚合验证脚本（node 直接跑，不依赖小程序环境）
const { review, weekStartMs } = require('../cloudfunctions/review_week/review');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✓' : '✗'} ${name}` + (ok ? '' : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
}

// 固定一个「本周三」的 nowMs，确保 wkStart 落在周一
const NOW = Date.UTC(2026, 5, 10, 4, 0, 0); // 2026-06-10 周三 12:00 CST
const wk = weekStartMs(NOW);
const inWeek = wk + 86400 * 1000;      // 本周内（周二）
const lastWeek = wk - 2 * 86400 * 1000; // 上周，应被排除

const projects = [
  { project_id: 'p1', name: '读书', color: '#7A9E7E' },
  { project_id: 'p2', name: '健身', color: '#E8B98A' },
];

// 完成分布：p1 两件、p2 一件、无项目一件
const doneTasks = [
  { project_id: 'p1', duration: 30, actual_duration: 45, finished_at: inWeek },
  { project_id: 'p1', duration: 60, actual_duration: 60, finished_at: inWeek },
  { project_id: 'p2', duration: 20, actual_duration: 10, finished_at: inWeek },
  { project_id: '',   duration: 15, actual_duration: 15, finished_at: inWeek },
  { project_id: 'p1', duration: 30, actual_duration: 30, finished_at: lastWeek }, // 上周，排除
];
const skipLogs = [
  { skip_reason: '没状态', created_at: inWeek },
  { skip_reason: '没状态', created_at: inWeek },
  { skip_reason: '等待外部', created_at: inWeek },
  { skip_reason: '没状态', created_at: lastWeek }, // 上周，排除
];

const r = review({ doneTasks, skipLogs, projects, nowMs: NOW });

eq('done_count 本周', r.done_count, 4);
eq('top_project 读书', r.top_project.name, '读书');
eq('top_project count', r.top_project.count, 2);
eq('分布条数', r.distribution.length, 3);
eq('无项目归零散', r.distribution.find((d) => d.project_id === '').name, '零散');
eq('跳过没状态计数', r.skip_counts.没状态, 2);
eq('跳过总数', r.skip_total, 3);
eq('耗时样本数', r.duration_bias.sample, 4);
eq('预估总和', r.duration_bias.est_minutes, 125); // 30+60+20+15
eq('实际总和', r.duration_bias.act_minutes, 130); // 45+60+10+15
eq('偏差比', r.duration_bias.ratio, 1); // 130/125=1.04 → round1 = 1
eq('空数据不报错', review({ doneTasks: [], skipLogs: [], projects: [], nowMs: NOW }).done_count, 0);
eq('空数据 top_project null', review({ doneTasks: [], skipLogs: [], projects: [], nowMs: NOW }).top_project, null);

// ---- 今日小结 + 环比 ----
eq('环比上周完成数', r.compare.last_done, 1);      // lastWeek 那条
eq('环比完成差值', r.compare.done_delta, 3);        // 本周4 - 上周1
eq('环比上周跳过数', r.compare.last_skip, 1);       // lastWeek 那条跳过
eq('今日完成数(完成都在周二，非今天周三)', r.today.done_count, 0);

// 专门构造今天的完成数据
const todayMs = NOW - 3600 * 1000; // 今天稍早
const r2 = review({
  doneTasks: [
    { project_id: 'p1', action: '读了10页', duration: 30, actual_duration: 40, finished_at: todayMs },
    { project_id: 'p2', action: '跑了3公里', duration: 20, actual_duration: 20, finished_at: todayMs },
  ],
  skipLogs: [], projects, nowMs: NOW,
});
eq('今日完成数', r2.today.done_count, 2);
eq('今日专注分钟', r2.today.minutes, 60);            // 40+20
eq('今日完成清单条数', r2.today.actions.length, 2);
eq('连续行动天数(只今天)', r2.today.streak_days, 1);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
