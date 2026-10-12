export const CONVERSATION_STYLES=['concise','conversational','expressive'];
export function conversationSetting(data,project){return data.conversationStyles?.[project]||{style:'conversational',revision:0};}
export function conversationInstruction(style='conversational'){
  const voice={
    concise:'Be brief and matter-of-fact. Lead with the result, blocker, or specific question.',
    conversational:'Write like a thoughtful colleague: natural sentences, contractions, and brief appreciation when it fits. Keep messages direct and useful.',
    expressive:'Let your role have a warm, lively voice. Use natural enthusiasm, humor, or encouragement when appropriate, while keeping the actual work easy to follow.'
  }[style];
  if(!voice)throw new Error('Unsupported conversation style');
  return `[HeloScrum communication style: ${style}]\n${voice} Keep exact task references, evidence, uncertainty and unrun checks accurate. Never invent results, lived experiences or emotions. Do not send banter-only messages, acknowledgments that wake teammates, or extra messages just to perform this style. The task and review rules still apply.`;
}
