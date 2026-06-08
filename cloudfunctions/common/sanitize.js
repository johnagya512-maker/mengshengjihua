// cloudfunctions/common/sanitize.js — 输入过滤，防 XSS / SQL注入 / Prompt Injection

// 基础危险模式
const INJECTION_PATTERNS = [
  /ignore\s+(previous|above|all)\s+instructions/gi,
  /you\s+are\s+now/gi,
  /system\s*prompt/gi,
  /<script[\s\S]*?>/gi,
  /(\b)(select|insert|update|delete|drop|union)\b\s+.*\b(from|into|table)\b/gi,
];

/**
 * 清洗用户输入：去标签、压缩 prompt 注入痕迹、长度截断。
 * @param {string} text
 * @param {number} maxLen
 */
function sanitize(text, maxLen = 500) {
  if (typeof text !== 'string') return '';
  let s = text.trim().slice(0, maxLen);
  // 去 HTML 标签
  s = s.replace(/<[^>]*>/g, '');
  // 中和注入指令（替换为占位，不直接删除以保留语义可读性）
  INJECTION_PATTERNS.forEach((re) => {
    s = s.replace(re, '[已过滤]');
  });
  return s;
}

/**
 * 校验是否为有效任务输入（非纯空白/纯数字/纯符号）。
 */
function isValidTaskInput(text) {
  if (!text || !text.trim()) return false;
  if (/^\d+$/.test(text.trim())) return false;
  if (!/[一-龥a-zA-Z]/.test(text)) return false; // 至少含一个中英文字符
  return true;
}

module.exports = { sanitize, isValidTaskInput };
