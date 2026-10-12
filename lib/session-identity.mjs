export const sessionKey = task => task.external ? `${task.id}:external:${task.externalSessionId}` : task.providerSessionId ? `${task.id}:${task.kind}:${task.providerSessionId}` : null;
