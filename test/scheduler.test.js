// 排期算法验证脚本（node 直接跑，不依赖小程序环境）
const { schedule, dailyCapacity } = require('../cloudfunctions/schedule_compute/scheduler');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✓' : '✗'} ${name}` + (ok ? '' : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`));
  ok ? pass++ : fail++;
}

// 1. 容量计算：6h × 1.0 = 360min（所见即所得，无 buffer）
eq('capacity 6h', dailyCapacity(6), 360);

// 2. 基础排期 + 顺序
const r1 = schedule({
  profile: { ideal_work_hours: 6, peak_hours: ['09:00-11:00'] },
  nowMinute: 540, // 09:00
  tasks: [
    { task_id: 'a', duration: 30, created_at: 1 },
    { task_id: 'b', duration: 45, is_priority: true, created_at: 2 },
  ],
});
eq('priority first', r1.ordered_tasks[0].task_id, 'b');
eq('scheduled time b', r1.ordered_tasks[0].scheduled_time, '09:00');
eq('scheduled time a', r1.ordered_tasks[1].scheduled_time, '09:45');
eq('capacity used', r1.daily_capacity_used, 75);

// 3. 容量溢出
const r2 = schedule({
  profile: { ideal_work_hours: 1, peak_hours: [] }, // 48min 容量
  nowMinute: 540,
  tasks: [
    { task_id: 'a', duration: 45, created_at: 1 },
    { task_id: 'b', duration: 30, created_at: 2 },
  ],
});
eq('overflow count', r2.overflow_tasks.length, 1);
eq('overflow task', r2.overflow_tasks[0].task_id, 'b');

// 4. 跳过历史影响排序（同优先级，跳过多的靠后）
const r4 = schedule({
  profile: { ideal_work_hours: 6, peak_hours: [] },
  nowMinute: 540,
  skipStats: { a: 3, b: 0 },
  tasks: [
    { task_id: 'a', duration: 30, created_at: 1 },
    { task_id: 'b', duration: 30, created_at: 2 },
  ],
});
eq('less-skipped first', r4.ordered_tasks[0].task_id, 'b');

// 6. 隐形学习耗时校正（规则3）：duration_bias 是全局系数，整体放大/缩小预估耗时
const r5 = schedule({
  profile: { ideal_work_hours: 6, peak_hours: [], duration_bias: 1.4 },
  nowMinute: 540,
  tasks: [
    { task_id: 'a', duration: 30, created_at: 1 }, // 30×1.4=42
    { task_id: 'b', duration: 30, created_at: 2 }, // 30×1.4=42
  ],
});
eq('bias applied globally', r5.daily_capacity_used, 84); // 42 + 42
eq('biased task scheduled_time', r5.ordered_tasks[1].scheduled_time, '09:42'); // 第二条从 09:42 起
// 无 bias 时不被校正（回归保护）
const r6 = schedule({
  profile: { ideal_work_hours: 6, peak_hours: [] },
  nowMinute: 540,
  tasks: [{ task_id: 'a', duration: 30, created_at: 1 }],
});
eq('no bias => raw duration', r6.daily_capacity_used, 30);

// 7. 跳过归因加权（规则5）：等待外部=环境阻塞，不该被当回避往后压
const r7 = schedule({
  profile: { ideal_work_hours: 6, peak_hours: [] },
  nowMinute: 540,
  // a 跳过 3 次但都是「等待外部」(权重0)；b 跳过 1 次「没状态」(权重1)
  skipStats: { a: { 等待外部: 3 }, b: { 没状态: 1 } },
  tasks: [
    { task_id: 'a', duration: 30, created_at: 1 },
    { task_id: 'b', duration: 30, created_at: 2 },
  ],
});
eq('blocked task not penalized', r7.ordered_tasks[0].task_id, 'a'); // a 回避分0 < b 回避分1，排前
// 向后兼容：数字型 skipStats 仍按原始计数生效
const r8 = schedule({
  profile: { ideal_work_hours: 6, peak_hours: [] },
  nowMinute: 540,
  skipStats: { a: 3, b: 0 },
  tasks: [
    { task_id: 'a', duration: 30, created_at: 1 },
    { task_id: 'b', duration: 30, created_at: 2 },
  ],
});
eq('numeric skipStats still works', r8.ordered_tasks[0].task_id, 'b');

// 8. 已完成时长从可用容量扣除（修复容量重复计账）：6h=360min 容量，已用 342min，仅剩 18min
const r9 = schedule({
  profile: { ideal_work_hours: 6, peak_hours: [] },
  nowMinute: 540,
  usedMinutes: 342,
  tasks: [
    { task_id: 'a', duration: 30, created_at: 1 }, // 30 > 剩余18 → 溢出
    { task_id: 'b', duration: 15, created_at: 2 }, // 15 <= 18 → 排入
  ],
});
eq('used capacity deducted: a overflows', r9.overflow_tasks[0].task_id, 'a');
eq('used capacity deducted: b fits', r9.ordered_tasks[0].task_id, 'b');
eq('used capacity deducted: only 15 scheduled', r9.daily_capacity_used, 15);

// 9. 越午夜不回绕：22:00(1320) 起排，120min 任务会越过 24:00 → 溢出而非显示成 00:00
const r10 = schedule({
  profile: { ideal_work_hours: 12, peak_hours: [] }, // 容量足够大，仅测午夜边界
  nowMinute: 1320,
  tasks: [
    { task_id: 'a', duration: 90, created_at: 1 },  // 1320+90=1410(23:30) ok
    { task_id: 'b', duration: 60, created_at: 2 },  // 1410+60=1470 > 1440 → 溢出
  ],
});
eq('midnight: a scheduled', r10.ordered_tasks[0].scheduled_time, '22:00');
eq('midnight: b overflows not wraps', r10.overflow_tasks[0].task_id, 'b');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
