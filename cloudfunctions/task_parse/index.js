// cloudfunctions/task_parse/index.js — AI 任务解析（DeepSeek）
const cloud = require('wx-server-sdk');
const https = require('https');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

const DURATION_ENUM = [15, 30, 45, 60, 75, 90, 105, 120];

function sanitize(text) {
  if (typeof text !== 'string') return '';
  let s = text.trim().slice(0, 500).replace(/<[^>]*>/g, '');
  // 中和常见 prompt 注入（中英文）：忽略指令、角色改写、系统提示词探测
  s = s.replace(/ignore\s+(previous|above|all)\s+instructions/gi, '[已过滤]');
  s = s.replace(/(忽略|无视|忘记)(以上|上述|之前|前面)?(的)?(所有)?(指令|指示|提示|要求)/g, '[已过滤]');
  s = s.replace(/(你现在是|从现在起你是|扮演|假装你是|now you are|you are now)/gi, '[已过滤]');
  s = s.replace(/(系统提示词?|system\s*prompt|开发者模式|developer\s*mode)/gi, '[已过滤]');
  return s;
}
function isValidTaskInput(t) {
  return !!(t && t.trim() && !/^\d+$/.test(t.trim()) && /[一-龥a-zA-Z]/.test(t));
}
function nearestDuration(d) {
  return DURATION_ENUM.reduce((p, c) => (Math.abs(c - d) < Math.abs(p - d) ? c : p), 60);
}

function callAI(messages) {
  const body = JSON.stringify({ model: 'deepseek-chat', messages, temperature: 0.3, response_format: { type: 'json_object' } });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.deepseek.com', path: '/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Length': Buffer.byteLength(body) },
      timeout: 18000,
    }, (res) => {
      let data = ''; res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data).choices[0].message.content); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject); req.write(body); req.end();
  });
}

const SYS_PROMPT = `你是「闷声计划」的任务解析助手。把用户的自然语言整理成可执行任务，输出严格 JSON。

先判断这是「单个小任务」还是「一件大事」：
- 大事的特征：预估耗时 > 单次专注时长，或措辞含「项目/方案/搞定/上线/筹备/系统/完整」等。
- 大事要拆成 2~5 个可执行小步，每步是动词开头的一句话，单步耗时不超过用户的单次专注时长。

字段：
- is_big_task: 是否为需要拆分的大事（true/false）
- action: 任务目标，动词开头一句话，≤100字（大事时为这件事的总目标）
- duration: 预估耗时分钟，只能是 15/30/45/60/75/90/105/120 之一（大事时为总耗时）
- project_tag: 关联项目名。与「已有项目」语义相近则复用其名称，否则新建简短项目名（≤30字）
- vision_statement: 激励性愿景短句，≤80字
- subtasks: 仅当 is_big_task=true 时给出，数组，每项 { action:动词开头一句话≤100字, duration:同上枚举 }；否则为空数组 []

只输出 JSON，不要解释。`;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail(400, '登录态无效'); // 守卫：未登录不得触发付费 AI 调用
  const raw = event.input_text;
  const allowSplit = !!event.allow_split; // 默认不拆分：快速建单条
  if (!isValidTaskInput(raw)) return fail(422, '没太理解，能再说清楚一点吗？');
  const input = sanitize(raw);
  const forcePlan = !!event.force_plan; // 项目规划：强制把目标拆成路线，不论是否判为大事

  let existingProjects = [];
  let focusTolerance = 45;
  try {
    const res = await db.collection('projects').where({ _openid: OPENID }).field({ name: true }).get();
    existingProjects = res.data.map((p) => p.name);
    const prof = await db.collection('profiles').where({ _openid: OPENID }).field({ focus_tolerance: true }).get();
    if (prof.data[0] && prof.data[0].focus_tolerance) focusTolerance = prof.data[0].focus_tolerance;
  } catch (e) { /* 非致命 */ }

  let content;
  try {
    const planHint = forcePlan
      ? '\n【强制规划模式】这是用户的一个项目目标，必须当作大事处理：is_big_task 返回 true，并拆成 3~5 个动词开头的可执行步骤放进 subtasks。'
      : '';
    content = await callAI([
      { role: 'system', content: SYS_PROMPT },
      { role: 'user', content: `已有项目：${JSON.stringify(existingProjects)}\n用户单次专注时长：${focusTolerance}分钟（拆分时单步不要超过它）${planHint}\n用户输入：${input}` },
    ]);
  } catch (e) {
    return fail(e.message === 'timeout' ? 504 : 500, 'AI 接口调用失败');
  }

  let parsed;
  try { parsed = JSON.parse(content); } catch (e) { return fail(500, 'AI 返回格式异常'); }

  // 子任务清洗：限粒度、归一化耗时、最多 5 步。开启拆分或强制规划时生效
  let subtasks = [];
  if ((allowSplit || forcePlan) && Array.isArray(parsed.subtasks)) {
    subtasks = parsed.subtasks
      .filter((s) => s && s.action)
      .slice(0, 5)
      .map((s) => ({
        action: String(s.action).slice(0, 100),
        duration: nearestDuration(Number(s.duration) || 30),
      }));
  }

  const isBig = (forcePlan || !!parsed.is_big_task) && subtasks.length >= 2;
  const result = {
    is_big_task: isBig,
    action: String(parsed.action || '').slice(0, 100),
    duration: nearestDuration(Number(parsed.duration) || 30),
    project_tag: String(parsed.project_tag || '未分类').slice(0, 30),
    // 愿景仅给「大事」——碎任务不配口号，避免廉价励志
    vision_statement: isBig ? String(parsed.vision_statement || '').slice(0, 80) : '',
    is_new_project: !existingProjects.includes(parsed.project_tag),
    subtasks,
  };
  if (!result.action) return fail(422, '没太理解，能再说清楚一点吗？');
  return ok(result);
};
