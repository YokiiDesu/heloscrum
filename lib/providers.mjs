// Shared by task creation, session settings, and both transcript views.
export const nativeProviderIds = ['codex', 'claude', 'kiro'];
export const cliProviderIds = [...nativeProviderIds, 'cursor', 'gemini'];
export const endpointProviderIds = ['ollama', 'llamacpp', 'lmstudio', 'bedrock', 'sagemaker'];
export const providerIds = [...cliProviderIds, ...endpointProviderIds];
export const managedProvider = value => {const kind=typeof value==='string'?value:value.kind;return kind==='cursor'?value?.nativeSetup?.cursorMode!=='interactive':kind==='gemini'||endpointProviderIds.includes(kind);};
export const providerName = kind => ({codex:'Codex',claude:'Claude Code',kiro:'Kiro CLI',cursor:'Cursor CLI',gemini:'Gemini CLI',ollama:'Ollama',llamacpp:'llama.cpp',lmstudio:'LM Studio',bedrock:'Amazon Bedrock',sagemaker:'Amazon SageMaker AI',jev:'Jev · TypeSafe','codex-summary':'Codex · summaries','claude-summary':'Claude Code · summaries'})[kind] || kind;
export const providerSetupLabel = (kind,available) => available?'':endpointProviderIds.includes(kind)?' · connection needed':' · not installed';
export const providerBinary = kind => ({kiro:'kiro-cli',cursor:'cursor-agent'})[kind] || kind;
