// cloudfunctions/task_parse/index.js — AI 任务解析（DeepSeek）
const cloud = require('wx-server-sdk');
const https = require('https');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function ok(data) { return { code: 200, data }; }
function fail(code, msg) { return { code, msg }; }

// 内容安全检测：违规输入在发往境外 AI 前就拦下（既合规也省 AI 调用）。
// 检测服务异常时放行，避免误伤——安全网而非硬闸门。
async function isTextSafe(text, openid) {
  const content = String(text || '').trim();
  if (!content) return true;
  try {
    const r = await cloud.openapi.security.msgSecCheck({
      version: 2, scene: 1, openid, content: content.slice(0, 2500),
    });
    return r && r.result && r.result.suggest === 'pass';
  } catch (e) {
    console.error('msgSecCheck 异常，放行:', e && e.errCode);
    return true;
  }
}

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

# 第一步：判断要不要拆
拆解的价值是「替用户消除决策、降低启动门槛」。
判定 is_big_task：
- 满足任一即为大事(true)：
  ① 含明确数量(发2篇/跑3次/读5章)或模糊复数(做几个视频/写一些文案/改好几处)；
  ② 天然多阶段(措辞含项目/方案/上线/筹备/系统/完整，或预估耗时 > 用户单次专注时长)；
  ③ 【开关已开时】哪怕是「做一篇/写一份/设计一个/准备一次」这类单数但需要"过程"的任务，只要不是一步就能完成的原子动作，也判为 true 并拆出起步步骤。如「做一篇小红书笔记」→ 选题定标题 / 拍图或写正文 / 排版发布。
- 仅以下情况为 false：真正一步完成的原子动作(回个邮件/整理桌面/打个电话/倒杯水/发条消息)，这类即使开了开关也不要硬拆。
- 判断口径：开关已开 = 用户主动想要拆，请倾向于拆(拿不准就拆)；除非它显然是上面那种一步完成的小事。

# 第二步：要拆时，按类型拆对，步数随任务规模走（不要凑数，也不要硬压）
- 数量型：含明确数字(N篇/个/次/章)按数量拆成 N 个单元；含模糊复数(几个/一些/多个/好几)按 3 个估。
  【铁律·数量型只拆一层】每个单元就是一步、一次完整产出，绝不能再嵌套「确定主题/录制/剪辑/导出」等子流程；步数 = 数量本身。
  如「做几个剪辑视频」→ 恰好 3 步：「剪好第1个视频」「剪好第2个视频」「剪好第3个视频」。不是 9 步。
  【铁律·不加戏】只拆用户说了的事，绝不擅自增加用户没提的环节(如用户只说「剪辑」，不要加「录制/拍摄/策划」)。
- 阶段型：按真实推进顺序拆，简单的事 2~3 步即可，复杂的事(系统/上线/筹备)可拆到 6~8 步。步数由这件事的真实复杂度决定，不要为凑齐而拆，也不要为省事而压。
- 拆出的单步若仍超过用户单次专注时长，可以再切；但每一步都必须是有意义的独立推进，不是机械等分。

# 铁律：每一步必须带「具体产出物或对象」，且要「小到不可能拒绝」
- 禁止纯动词空壳：「确定主题」「准备素材」「检查发布」「开始整理」这类放之四海皆准的废话一律不要。
- 每步要么含具体产出(写出两篇的标题+一句话主题)，要么含具体对象(粗剪历史事件的3条素材)。
- 拆解的真正价值是「降低启动门槛」：把人卡住的大事，化成第一眼就敢点「开始」的小动作。
- 【第一步极小】第一步必须是 2~5 分钟内、坐下就能做完的最小动作（如「打开剪辑软件，新建一个工程」「列出3个候选标题」），让用户毫无心理负担地启动。后续步骤可逐渐展开。
- 每一步都是一次完整、自足的推进，做完有「推进了一点」的实感，不是机械等分。

字段：
- is_big_task: 见上
- action: 任务目标，动词开头一句话，≤100字(大事时为这件事的总目标)
- duration: 预估耗时分钟，只能是 15/30/45/60/75/90/105/120 之一。大事时为「完成整件事的总耗时」(会落在大任务上，子任务不再单独计时)
- project_tag: 关联项目名。与「已有项目」语义相近则复用其名称，否则新建简短项目名(≤30字)
- vision_statement: 激励性愿景短句，≤80字
- subtasks: 仅当 is_big_task=true 时给出，数组，步数由任务复杂度决定(数量型=数量，阶段型简单2~3步/复杂6~8步)，每项只含 { action:动词开头一句话且含具体产出物≤100字 }，不要给 duration(时间只在大任务上)；否则为空数组 []

只输出 JSON，不要解释。`;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail(400, '登录态无效'); // 守卫：未登录不得触发付费 AI 调用
  const raw = event.input_text;
  const allowSplit = !!event.allow_split; // 默认不拆分：快速建单条
  if (!isValidTaskInput(raw)) return fail(422, '没太理解，能再说清楚一点吗？');
  const input = sanitize(raw);
  const forcePlan = !!event.force_plan; // 项目规划：强制把目标拆成路线，不论是否判为大事

  // 内容安全：违规输入在发往境外 AI 前拦下（合规 + 省调用）
  if (!(await isTextSafe(input, OPENID))) return fail(422, '内容含违规信息，换个说法试试');

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
      ? '\n【规划模式】用户明确要为这个目标做规划：is_big_task 返回 true，按上面的「数量型/阶段型」规则拆成可执行步骤放进 subtasks。每步必须带具体产出物或对象，禁止纯动词空壳。'
      : '';
    // 把拆解开关状态告诉 AI：开了就倾向于拆（拿不准就拆），只放过真正一步完成的原子动作
    const splitHint = (allowSplit && !forcePlan)
      ? '\n【拆解开关：已开】用户主动要求拆解，请倾向于拆：哪怕是「做一篇/写一份/设计一个」这类单数但需要过程的任务，只要不是一步就能做完的原子动作(回邮件/打电话)，都判 is_big_task=true 并拆出起步步骤。'
      : '\n【拆解开关：未开】用户只想快速记一条，is_big_task 一律返回 false，subtasks 留空。';
    content = await callAI([
      { role: 'system', content: SYS_PROMPT },
      { role: 'user', content: `已有项目：${JSON.stringify(existingProjects)}\n用户单次专注时长：${focusTolerance}分钟（拆分时单步不要超过它）${planHint}${splitHint}\n用户输入：${input}` },
    ]);
  } catch (e) {
    return fail(e.message === 'timeout' ? 504 : 500, 'AI 接口调用失败');
  }

  let parsed;
  try { parsed = JSON.parse(content); } catch (e) { return fail(500, 'AI 返回格式异常'); }

  // 子任务清洗：限粒度、最多 8 步（按规模不锁死，仅防 AI 失控）。时间只在大任务，子任务不带 duration。
  let subtasks = [];
  if ((allowSplit || forcePlan) && Array.isArray(parsed.subtasks)) {
    subtasks = parsed.subtasks
      .filter((s) => s && s.action)
      .slice(0, 8)
      .map((s) => ({ action: String(s.action).slice(0, 100) }));
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
