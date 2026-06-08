// utils/request.ts — 统一云函数调用层

import { getToken, clearAuth } from './auth';
import { ERROR_MESSAGES, TIMEOUT_AI, TIMEOUT_NORMAL } from './constants';
import { mockCall } from './mock';

// ⚠️ 本地演示开关：true = 全部走本地假数据，不依赖云开发。
// 上线接云函数前置为 false。
export const USE_MOCK = false;

interface CloudResult<T> {
  code: number;
  data?: T;
  msg?: string;
}

interface CallOptions {
  isAI?: boolean;     // AI 接口用更长超时
  silent?: boolean;   // 不弹默认错误提示
}

/**
 * 调用云函数，统一注入 token、超时、错误码→文案。
 * @param name 云函数名
 * @param data 业务参数
 */
export function callCloud<T = any>(
  name: string,
  data: Record<string, any> = {},
  options: CallOptions = {}
): Promise<T> {
  const { isAI = false, silent = false } = options;

  // 本地演示模式
  if (USE_MOCK) {
    return mockCall(name, data).catch((e) => {
      if (!silent) wx.showToast({ title: e.msg || ERROR_MESSAGES[500], icon: 'none' });
      throw e;
    });
  }

  const timeout = isAI ? TIMEOUT_AI : TIMEOUT_NORMAL;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const code = isAI ? 504 : 0;
      if (!silent) wx.showToast({ title: ERROR_MESSAGES[code], icon: 'none' });
      reject({ code, msg: ERROR_MESSAGES[code] });
    }, timeout);

    wx.cloud.callFunction({
      name,
      data: { ...data, token: getToken() },
      success: (res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const result = res.result as CloudResult<T>;
        if (result && result.code === 200) {
          resolve(result.data as T);
        } else {
          const code = result?.code ?? 500;
          if (code === 401) clearAuth();
          if (!silent) {
            wx.showToast({ title: result?.msg || ERROR_MESSAGES[code] || ERROR_MESSAGES[500], icon: 'none' });
          }
          reject({ code, msg: result?.msg });
        }
      },
      fail: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!silent) wx.showToast({ title: ERROR_MESSAGES[0], icon: 'none' });
        reject({ code: 0, msg: ERROR_MESSAGES[0] });
      },
    });
  });
}
