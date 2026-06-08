// cloudfunctions/project_record/period.js — result 模式周期判断（纯函数，可独立测试）
// cycle: month / week / none。判断「上次记录」是否落在当前周期之前 → 需归零重置。

function cstParts(ms) {
  const d = new Date(ms + 8 * 3600 * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), date: d.getUTCDate(), dow: d.getUTCDay() };
}

// 当前周期的起点时间戳（毫秒，东八区对齐）
function periodStartMs(cycle, nowMs) {
  const p = cstParts(nowMs);
  if (cycle === 'month') {
    return Date.UTC(p.y, p.m, 1) - 8 * 3600 * 1000;
  }
  if (cycle === 'week') {
    const dow = (p.dow + 6) % 7; // 周一=0
    return Date.UTC(p.y, p.m, p.date - dow) - 8 * 3600 * 1000;
  }
  return 0; // none：无周期，永不重置
}

// 上次记录时间是否在当前周期之前 → true 表示该先归零
function shouldReset(cycle, lastAtMs, nowMs) {
  if (cycle !== 'month' && cycle !== 'week') return false;
  if (!lastAtMs) return false; // 从未记录，无需重置
  return lastAtMs < periodStartMs(cycle, nowMs);
}

// 计算「记一笔」后的新值：跨周期则从 0 起算，否则在原值上累加
function applyRecord({ cycle, current_value = 0, current_value_at = 0, delta, nowMs }) {
  const base = shouldReset(cycle, current_value_at, nowMs) ? 0 : (current_value || 0);
  return Math.round((base + Number(delta)) * 100) / 100;
}

// 列表展示用的「有效当前值」：跨周期未更新则显示 0
function effectiveValue(cycle, current_value = 0, current_value_at = 0, nowMs) {
  return shouldReset(cycle, current_value_at, nowMs) ? 0 : (current_value || 0);
}

module.exports = { periodStartMs, shouldReset, applyRecord, effectiveValue };
