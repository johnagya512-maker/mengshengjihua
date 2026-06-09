// utils/voice.ts — 语音录入：录音 + 同声传译 ASR
// 依赖微信「同声传译」插件 WechatSI。未授权/未配置时优雅降级，不影响文字输入。

interface VoiceCallbacks {
  onStart?: () => void;
  onResult: (text: string) => void;   // 识别成功（非空）
  onError: (msg: string) => void;     // 失败 / 没录到声音 / 插件不可用
}

let manager: any = null;
let bound = false;
let cbs: VoiceCallbacks | null = null;
let pluginReady: boolean | null = null; // null=未探测

// 懒加载插件，捕获未授权异常
function getManager(): any {
  if (pluginReady === false) return null;
  if (manager) return manager;
  try {
    const plugin = requirePlugin('WechatSI');
    manager = plugin.getRecordRecognitionManager();
    pluginReady = true;
    return manager;
  } catch (e) {
    pluginReady = false;
    return null;
  }
}

function ensureBound(mgr: any) {
  if (bound) return;
  bound = true;
  mgr.onStart = () => cbs?.onStart?.();
  mgr.onStop = (res: { result?: string }) => {
    const text = (res.result || '').trim();
    if (text) cbs?.onResult(text);
    else cbs?.onError('没录到声音');
  };
  mgr.onError = () => cbs?.onError('没录到声音');
}

/** 语音是否可用（插件已配置且授权） */
export function isVoiceAvailable(): boolean {
  return getManager() !== null;
}

/** 长按开始：申请录音权限后启动识别 */
export function startVoice(callbacks: VoiceCallbacks): void {
  const mgr = getManager();
  if (!mgr) { callbacks.onError('语音功能未开启'); return; }
  cbs = callbacks;
  ensureBound(mgr);
  wx.getSetting({
    success: (s) => {
      if (s.authSetting['scope.record']) {
        mgr.start({ lang: 'zh_CN' });
        return;
      }
      wx.authorize({
        scope: 'scope.record',
        success: () => mgr.start({ lang: 'zh_CN' }),
        fail: () => {
          // 已拒绝过：引导去设置页重新打开麦克风权限
          wx.showModal({
            title: '需要麦克风权限',
            content: '开启后即可长按说话录入任务',
            confirmText: '去开启',
            success: (r) => { if (r.confirm) wx.openSetting(); },
          });
          callbacks.onError('需要麦克风权限');
        },
      });
    },
    fail: () => callbacks.onError('需要麦克风权限'),
  });
}

/** 松开结束：停止识别，结果走 onStop 回调 */
export function stopVoice(): void {
  if (manager) manager.stop();
}
