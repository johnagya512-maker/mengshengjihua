// cloudfunctions/common/ai.js — DeepSeek 调用封装（供 task_parse 等使用）
// Key 仅存于云函数环境变量，绝不下发前端。
const https = require('https');

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = 'deepseek-chat';

/**
 * 调用 DeepSeek chat completions。
 * @param {Array<{role:string,content:string}>} messages
 * @param {object} opts { jsonMode, timeout }
 * @returns {Promise<string>} 模型返回的 content
 */
function chat(messages, opts = {}) {
  const { jsonMode = true, timeout = 8000 } = opts;
  const body = JSON.stringify({
    model: MODEL,
    messages,
    temperature: 0.3,
    response_format: jsonMode ? { type: 'json_object' } : undefined,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.deepseek.com',
        path: '/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEEPSEEK_KEY}`,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.message?.content;
            if (!content) return reject(new Error('AI empty response'));
            resolve(content);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('AI timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { chat };
