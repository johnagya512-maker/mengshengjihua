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

// ---- 复盘页文案（方向 v1.1 §4：只陈述事实 + 轻量建议，不评判）----

// 跳过归因的轻量解读：哪类偏多给不同接话
export function skipInsight(counts: { 没状态: number; 等待外部: number; 临时取消: number }): string {
  const total = counts.没状态 + counts.等待外部 + counts.临时取消;
  if (total === 0) return '这周没跳过什么，节奏挺稳';
  const max = Math.max(counts.没状态, counts.等待外部, counts.临时取消);
  if (counts.等待外部 === max) return '多数跳过是在等外部，不是你的问题，能催的催一下';
  if (counts.没状态 === max) return '多数跳过是没状态，也许是把硬活排在了精力低谷';
  return '多数是临时取消，计划本来就会变，正常';
}

// 耗时偏差解读：>1 习惯性低估，<1 习惯性高估
export function biasInsight(ratio: number, sample: number): string {
  if (!sample) return '完成的任务还不够多，耗时认知先攒着';
  if (ratio >= 1.2) return `实际比预估多花约 ${Math.round((ratio - 1) * 100)}%，排期时可以多留点余量`;
  if (ratio <= 0.8) return `实际比预估少花约 ${Math.round((1 - ratio) * 100)}%，你其实比想象中快`;
  return '预估和实际基本对得上，这个手感不错';
}

// 本周完成总览
export function reviewHeadline(doneCount: number, topName: string): string {
  if (doneCount === 0) return '这周还没完成记录，做一件就有了';
  if (topName) return `这周清掉 ${doneCount} 件，「${topName}」推进最多`;
  return `这周清掉 ${doneCount} 件`;
}
