// result 周期判断验证脚本（node 直接跑）
const { periodStartMs, shouldReset, applyRecord, effectiveValue } = require('../cloudfunctions/project_record/period');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✓' : '✗'} ${name}` + (ok ? '' : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
}

const NOW = Date.UTC(2026, 5, 10, 4, 0, 0); // 2026-06-10 周三 12:00 CST
const monthStart = periodStartMs('month', NOW);
const weekStart = periodStartMs('week', NOW);
const lastMonth = Date.UTC(2026, 4, 20) - 8 * 3600 * 1000; // 5月，上个月
const earlierThisMonth = Date.UTC(2026, 5, 2) - 8 * 3600 * 1000; // 6/2，本月内但上周
const yesterday = NOW - 86400 * 1000;

// periodStart 落点
eq('月周期起点=6/1 CST', new Date(monthStart + 8 * 3600 * 1000).toISOString().slice(0, 10), '2026-06-01');
eq('周周期起点=周一6/8 CST', new Date(weekStart + 8 * 3600 * 1000).toISOString().slice(0, 10), '2026-06-08');

// shouldReset
eq('月：上月记录需重置', shouldReset('month', lastMonth, NOW), true);
eq('月：本月记录不重置', shouldReset('month', earlierThisMonth, NOW), false);
eq('周：本月上周记录需重置', shouldReset('week', earlierThisMonth, NOW), true);
eq('周：昨天记录不重置', shouldReset('week', yesterday, NOW), false);
eq('none：永不重置', shouldReset('none', lastMonth, NOW), false);
eq('从未记录不重置', shouldReset('month', 0, NOW), false);

// applyRecord：跨周期归零再加，否则累加
eq('月：跨月归零起算', applyRecord({ cycle: 'month', current_value: 5000, current_value_at: lastMonth, delta: 200, nowMs: NOW }), 200);
eq('月：本月累加', applyRecord({ cycle: 'month', current_value: 5000, current_value_at: earlierThisMonth, delta: 200, nowMs: NOW }), 5200);
eq('none：始终累加', applyRecord({ cycle: 'none', current_value: 5000, current_value_at: lastMonth, delta: 200, nowMs: NOW }), 5200);
eq('小数累加保留2位', applyRecord({ cycle: 'none', current_value: 1.1, current_value_at: yesterday, delta: 2.22, nowMs: NOW }), 3.32);

// effectiveValue：跨周期未更新显示0
eq('月：跨月显示0', effectiveValue('month', 5000, lastMonth, NOW), 0);
eq('月：本月显示原值', effectiveValue('month', 5000, earlierThisMonth, NOW), 5000);
eq('none：始终原值', effectiveValue('none', 5000, lastMonth, NOW), 5000);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
