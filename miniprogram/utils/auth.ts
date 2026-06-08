// utils/auth.ts — 本地登录态管理

const TOKEN_KEY = 'ms_token';
const TOKEN_EXP_KEY = 'ms_token_exp';
const USER_ID_KEY = 'user_id';

export function setAuth(token: string, userId: string): void {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 天
  wx.setStorageSync(TOKEN_KEY, token);
  wx.setStorageSync(TOKEN_EXP_KEY, exp);
  wx.setStorageSync(USER_ID_KEY, userId);
}

export function getToken(): string {
  const exp = wx.getStorageSync(TOKEN_EXP_KEY) || 0;
  if (exp && Date.now() > exp) {
    clearAuth();
    return '';
  }
  return wx.getStorageSync(TOKEN_KEY) || '';
}

export function getUserId(): string {
  return wx.getStorageSync(USER_ID_KEY) || '';
}

export function clearAuth(): void {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(TOKEN_EXP_KEY);
  wx.removeStorageSync(USER_ID_KEY);
}

export function isLoggedIn(): boolean {
  return !!getToken();
}
