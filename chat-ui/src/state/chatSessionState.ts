import { ChatSession, Message, Provider } from '../types';
import { normalizeLegacyDisplayText } from '../chatUiShared';
import { RECONNECT_PLACEHOLDER_MESSAGE_PREFIX } from './chatStateCache';

export interface RunningSessionInfo {
  title: string;
  projectId?: string;
  provider?: Provider;
}

const RECONNECT_PLACEHOLDER_STATUS_LABELS = new Set([
  'Reconnecting after refresh',
  'Restored after refresh. Waiting for the next live update...'
]);

const isReconnectPlaceholderMessage = (message: Message): boolean => {
  if (message.role !== 'model') {
    return false;
  }

  if (message.id.startsWith(RECONNECT_PLACEHOLDER_MESSAGE_PREFIX)) {
    return true;
  }

  return message.process?.events.some(event => (
    event.type === 'status'
    && RECONNECT_PLACEHOLDER_STATUS_LABELS.has(event.label)
  )) || false;
};

const isRenderableModelMessage = (message: Message): boolean => {
  if (message.role !== 'model') {
    return false;
  }

  if (isReconnectPlaceholderMessage(message)) {
    return false;
  }

  if (message.status === 'error') {
    return true;
  }

  if (typeof message.content === 'string' && message.content.trim() !== '') {
    return true;
  }

  if (typeof message.thinking === 'string' && message.thinking.trim() !== '') {
    return true;
  }

  if (message.options && message.options.length > 0) {
    return true;
  }

  if (message.attachments && message.attachments.length > 0) {
    return true;
  }

  if (message.process && message.process.events.length > 0) {
    return true;
  }

  return false;
};

const getSessionRichness = (session: ChatSession): [number, number, number, number] => {
  const meaningfulMessages = session.messages.filter(message => !isReconnectPlaceholderMessage(message));
  const renderableModelCount = meaningfulMessages.filter(isRenderableModelMessage).length;
  const modelCount = meaningfulMessages.filter(message => message.role === 'model').length;
  const messageCount = meaningfulMessages.length;
  const latestTimestamp = meaningfulMessages[meaningfulMessages.length - 1]?.timestamp || session.createdAt || 0;

  return [renderableModelCount, modelCount, messageCount, latestTimestamp];
};

const preferMoreCompleteSession = (
  current: ChatSession | null,
  candidate: ChatSession | null
): ChatSession | null => {
  if (!candidate) {
    return current;
  }

  if (!current) {
    return candidate;
  }

  const currentScore = getSessionRichness(current);
  const candidateScore = getSessionRichness(candidate);

  for (let index = 0; index < currentScore.length; index += 1) {
    if (candidateScore[index] > currentScore[index]) {
      return candidate;
    }

    if (candidateScore[index] < currentScore[index]) {
      return current;
    }
  }

  return current;
};

const isEmptyText = (value?: string): boolean => !value || value.trim() === '';

const isSyntheticRunningPlaceholderMessage = (message?: Message | null): boolean => {
  if (!message || message.role !== 'model') {
    return false;
  }

  const hasRenderableText = !isEmptyText(message.content) || !isEmptyText(message.thinking);
  const hasStructuredOutput = Boolean(
    (message.options && message.options.length > 0)
    || (message.attachments && message.attachments.length > 0)
    || (message.tools && message.tools.length > 0)
  );

  if (hasRenderableText || hasStructuredOutput) {
    return false;
  }

  if (!message.process || message.process.events.length === 0) {
    return false;
  }

  return message.process.events.every(event => event.type === 'status');
};

const stripTrailingSyntheticRunningPlaceholder = (session: ChatSession | null): ChatSession | null => {
  if (!session || session.messages.length === 0) {
    return session;
  }

  const lastMessage = session.messages[session.messages.length - 1];
  if (!isSyntheticRunningPlaceholderMessage(lastMessage)) {
    return session;
  }

  return {
    ...session,
    messages: session.messages.slice(0, -1)
  };
};

const getTrailingRunningMessage = (session: ChatSession | null): Message | null => {
  if (!session || session.messages.length === 0) {
    return null;
  }

  const lastMessage = session.messages[session.messages.length - 1];
  if (lastMessage.role !== 'model' || lastMessage.status !== 'sending') {
    return null;
  }

  return lastMessage;
};

const preferRunningMessage = (current: Message | null, candidate: Message | null): Message | null => {
  if (!candidate) {
    return current;
  }

  if (!current) {
    return candidate;
  }

  const currentIsSynthetic = isSyntheticRunningPlaceholderMessage(current);
  const candidateIsSynthetic = isSyntheticRunningPlaceholderMessage(candidate);

  if (currentIsSynthetic !== candidateIsSynthetic) {
    return currentIsSynthetic ? candidate : current;
  }

  return candidate.timestamp > current.timestamp ? candidate : current;
};

export const findLocalSession = (
  sessions: ChatSession[],
  projectSessions: Record<string, ChatSession[]>,
  sessionId?: string | null,
  projectId?: string | null
): ChatSession | null => {
  if (!sessionId) {
    return null;
  }

  let bestMatch: ChatSession | null = null;

  if (projectId && projectSessions[projectId]) {
    bestMatch = preferMoreCompleteSession(
      bestMatch,
      projectSessions[projectId].find(item => item.id === sessionId) || null
    );
  }

  bestMatch = preferMoreCompleteSession(bestMatch, sessions.find(item => item.id === sessionId) || null);

  for (const candidateProjectId of Object.keys(projectSessions)) {
    if (candidateProjectId === projectId) {
      continue;
    }

    bestMatch = preferMoreCompleteSession(
      bestMatch,
      projectSessions[candidateProjectId].find(item => item.id === sessionId) || null
    );
  }

  return bestMatch;
};

export const resolveRunningSessionDetails = (
  sessionId: string,
  sessions: ChatSession[],
  projectSessions: Record<string, ChatSession[]>,
  runningSessionsInfo: Map<string, RunningSessionInfo>
): { title: string; projectId?: string; provider?: Provider } => {
  const infoFromMap = runningSessionsInfo.get(sessionId);
  let title = infoFromMap?.title;
  let projectId = infoFromMap?.projectId;
  let provider = infoFromMap?.provider;

  const rootSession = sessions.find(item => item.id === sessionId);
  if (rootSession) {
    if (!title) {
      title = rootSession.title;
    }
    if (!provider) {
      provider = rootSession.provider;
    }
  }

  if (!projectId || !title || !provider) {
    for (const [candidateProjectId, sessionList] of Object.entries(projectSessions)) {
      const found = sessionList.find(item => item.id === sessionId);
      if (!found) {
        continue;
      }

      if (!title) {
        title = found.title;
      }
      if (!projectId) {
        projectId = candidateProjectId;
      }
      if (!provider) {
        provider = found.provider;
      }
      break;
    }
  }

  return {
    title: normalizeLegacyDisplayText(title || sessionId.substring(0, 12)),
    projectId,
    provider
  };
};

export const resolveSessionProvider = (
  sessions: ChatSession[],
  projectSessions: Record<string, ChatSession[]>,
  projects: Array<{ id: string; provider: Provider }>,
  sessionId?: string | null,
  projectId?: string | null,
  fallback: Provider = 'claude'
): Provider => {
  const localSession = findLocalSession(sessions, projectSessions, sessionId, projectId);
  if (localSession?.provider) {
    return localSession.provider;
  }

  if (projectId) {
    const project = projects.find(item => item.id === projectId);
    if (project?.provider) {
      return project.provider;
    }
  }

  return fallback;
};

export const sessionHasRenderableResult = (
  sessions: ChatSession[],
  projectSessions: Record<string, ChatSession[]>,
  sessionId?: string | null,
  projectId?: string | null,
  fallbackSession?: ChatSession | null
): boolean => {
  const session = findLocalSession(sessions, projectSessions, sessionId, projectId) || fallbackSession || null;
  if (!session || session.messages.length === 0) {
    return false;
  }

  return session.messages.some(isRenderableModelMessage);
};

export const mergeSessionSummaryList = (
  existingSessions: ChatSession[],
  incomingSessions: ChatSession[]
): ChatSession[] => {
  const existingById = new Map(existingSessions.map(session => [session.id, session]));

  return incomingSessions.map(incomingSession => {
    const existingSession = existingById.get(incomingSession.id);
    if (!existingSession) {
      return incomingSession;
    }

    return {
      ...existingSession,
      ...incomingSession,
      title: incomingSession.title || existingSession.title,
      provider: incomingSession.provider || existingSession.provider,
      createdAt: incomingSession.createdAt || existingSession.createdAt,
      messages: incomingSession.messages.length > 0
        ? incomingSession.messages
        : existingSession.messages
    };
  });
};

export const mergeResumedSessionWithLocalState = (
  existingSession: ChatSession | null,
  resumedSession: ChatSession,
  options?: {
    preserveRunningState?: boolean;
  }
): ChatSession => {
  const existingBase = stripTrailingSyntheticRunningPlaceholder(existingSession);
  const resumedBase = stripTrailingSyntheticRunningPlaceholder(resumedSession) || resumedSession;
  const preferredBase = preferMoreCompleteSession(existingBase, resumedBase) || resumedBase;

  if (!options?.preserveRunningState) {
    return preferredBase;
  }

  const hasRunningModel = preferredBase.messages[preferredBase.messages.length - 1]?.role === 'model'
    && preferredBase.messages[preferredBase.messages.length - 1]?.status === 'sending';
  if (hasRunningModel) {
    return preferredBase;
  }

  const preferredRunningMessage = preferRunningMessage(
    getTrailingRunningMessage(existingSession),
    getTrailingRunningMessage(resumedSession)
  );

  if (!preferredRunningMessage) {
    return preferredBase;
  }

  return {
    ...preferredBase,
    messages: [...preferredBase.messages, preferredRunningMessage]
  };
};

export const mergeResumedSession = (
  existingSession: ChatSession | null,
  resumedSession: ChatSession,
  isRunning: boolean
): ChatSession => {
  return mergeResumedSessionWithLocalState(existingSession, resumedSession, {
    preserveRunningState: isRunning
  });
};

export const renameRunningSessionCollections = (
  runningSessions: Set<string>,
  runningSessionsInfo: Map<string, RunningSessionInfo>,
  oldSessionId: string,
  newSessionId: string,
  options?: {
    title?: string;
    provider?: Provider;
    projectId?: string;
  }
): {
  runningSessions: Set<string>;
  runningSessionsInfo: Map<string, RunningSessionInfo>;
} => {
  const nextRunningSessions = new Set(runningSessions);
  const nextRunningSessionsInfo = new Map(runningSessionsInfo);
  const existingInfo = nextRunningSessionsInfo.get(oldSessionId);

  nextRunningSessions.delete(oldSessionId);
  nextRunningSessions.add(newSessionId);
  nextRunningSessionsInfo.delete(oldSessionId);
  nextRunningSessionsInfo.set(newSessionId, {
    title: options?.title || existingInfo?.title || newSessionId.substring(0, 12),
    provider: options?.provider || existingInfo?.provider,
    projectId: options?.projectId || existingInfo?.projectId
  });

  return {
    runningSessions: nextRunningSessions,
    runningSessionsInfo: nextRunningSessionsInfo
  };
};

export const appendMessageToSessionList = (
  sessionList: ChatSession[],
  sessionId: string,
  message: Message
): ChatSession[] => sessionList.map(session => (
  session.id === sessionId
    ? { ...session, messages: [...session.messages, message] }
    : session
));
