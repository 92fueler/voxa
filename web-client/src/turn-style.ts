/** Conservative intent matching on finalized live user speech only; no archive/model calls. */
export type TurnStyle = 'everyday' | 'thinking';
export interface TurnPreference { style: TurnStyle; locked: boolean }
export const initialTurnPreference: TurnPreference = { style: 'everyday', locked: false };

export function turnPreference(text: string, current: TurnPreference): TurnPreference {
  const speech = text.toLowerCase().trim().replace(/[.!?。！？]+$/u, '').replace(/\s+/g, ' ');
  // Commands must be the utterance itself, not a quoted example or a negated request.
  const command = speech.replace(/^(?:please |(?:can|could) you (?:please )?|请)/u, '').replace(/,? please$/u, '');
  if (/^(?:give me (?:more )?thinking time|i need more thinking time|use thinking mode|let me take my time|给我(?:多一点|更多|一点)?思考时间|让我慢慢想)$/u.test(command)) return { style: 'thinking', locked: true };
  if (/^(?:use normal conversation|use normal (?:turn taking|turn-taking)|use everyday mode|恢复正常对话|用日常对话模式)$/u.test(command)) return { style: 'everyday', locked: true };
  if (/^(?:use automatic (?:turn taking|turn-taking)|switch back to automatic|自动调整对话节奏|恢复自动模式)$/u.test(command)) return { ...current, locked: false };
  if (current.locked || /["“”「」]/u.test(speech) || /\b(?:don't|do not|not now|stop|end|finish)\b/u.test(speech) || /不要|不想|结束/u.test(speech)) return current;
  if (/\b(?:mock interview me|interview me|let'?s (?:do|start|practice) (?:a |an )?(?:mock |system design |behavioral |technical )?interview|(?:help me|i want to|let'?s) (?:practice|learn|study|work through|think through|prepare for)|let me (?:explain|think through|work through)|quiz me|test my understanding|(?:can we|let'?s) (?:practice|study|design)|(?:i have|i want to discuss) (?:a |an )?(?:system design|technical|behavioral) question|walk me through (?:a |the )?(?:design|architecture)|i(?: am|'m) preparing for (?:a |an )?(?:technical |behavioral |system design )?interview)\b/u.test(speech)
    || /(?:模拟面试|帮我(?:学习|练习|理解)|我想(?:学习|练习)|让我(?:解释|想一想|思考)|一起(?:学习|练习)|我们来(?:设计|学习|练习)|我有(?:一个)?(?:技术|系统设计|行为面试)问题)/u.test(speech)) return { style: 'thinking', locked: false };
  if (/\b(?:let'?s (?:just |have a )?(?:chat|talk about (?:my|our) day)|back to (?:casual|everyday|normal) (?:chat|conversation)|(?:let'?s|i want to) (?:have a casual conversation|just chat))\b/u.test(speech)
    || /(?:随便聊聊|聊聊日常|聊聊今天|回到日常对话)/u.test(speech)) return { style: 'everyday', locked: false };
  return current;
}
