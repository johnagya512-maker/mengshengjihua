// utils/coach.ts — 教练式问责文案（设计文档 5.3）
// 原则：自主、支持、不评判。完成给正反馈；提醒配「帮你解决」的姿态；跳过按归因接话。

// 完成一件后的回响（按今日进度选，越接近清空越鼓励）
export function completeEcho(doneToday: number, remain: number): string {
  if (remain === 0) return '今天清空了，牛。';
  if (doneToday === 1) return '开了个头，这一件清掉了';
  if (remain === 1) return `清掉 ${doneToday} 件，就剩最后一件了`;
  return `清掉 ${doneToday} 件了，稳住节奏`;
}

// 今日进度行（队列非空时）。教练口吻：陪着推进，不催。
export function progressLine(doneToday: number, remain: number): string {
  if (doneToday === 0) return `今天有 ${remain} 件，挑一件顺手的开始`;
  return `已清掉 ${doneToday} 件，还有 ${remain} 件，不急`;
}

// 跳过后的接话（按归因，规则5）。绝不追问「为什么没做」。
export function skipReply(reason: string): string {
  switch (reason) {
    case '等待外部': return '这件在等别人，先放着，不算你的事';
    case '没状态':   return '状态不对就先跳过，回头排到你状态好的时候';
    case '临时取消': return '计划变了很正常，去做更要紧的';
    default:         return '先放一放，没关系';
  }
}
