import { Provider } from '../session/provider';
import { ClaudeMessage, ClaudeSession } from './types';

export interface SessionContextUsage {
  provider: Provider;
  budgetTokens: number;
  estimatedTokens: number;
  remainingTokens: number;
  overflowTokens: number;
  usedPercent: number;
  remainingPercent: number;
  isOverBudget: boolean;
  messageCount: number;
  estimatedCharacters: number;
  isEstimated: true;
}

export interface CompactPromptResult {
  prompt: string;
  summary: string;
  summarizedMessages: number;
  retainedMessages: number;
}

const DEFAULT_CONTEXT_BUDGETS: Record<Provider, number> = {
  claude: 200000,
  codex: 128000
};

function readBudgetOverride(provider: Provider): number | null {
  const providerKey = provider.toUpperCase();
  const providerSpecific = process.env[`CODEREMOTE_${providerKey}_CONTEXT_TOKENS`];
  const generic = process.env.CODEREMOTE_CONTEXT_TOKENS;
  const rawValue = providerSpecific || generic;

  if (!rawValue) {
    return null;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

export function getContextBudgetTokens(provider: Provider): number {
  return readBudgetOverride(provider) || DEFAULT_CONTEXT_BUDGETS[provider];
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

function countCodePoints(value: string): number {
  return Array.from(value).length;
}

function estimateTextTokens(value: string): number {
  const text = normalizeText(value);
  if (!text) {
    return 0;
  }

  const chars = Array.from(text);
  let estimate = 0;
  let asciiRun = 0;

  const flushAsciiRun = () => {
    if (asciiRun > 0) {
      estimate += asciiRun / 4;
      asciiRun = 0;
    }
  };

  for (const char of chars) {
    if (/\s/.test(char)) {
      flushAsciiRun();
      continue;
    }

    if (char.charCodeAt(0) <= 0x7f) {
      asciiRun += 1;
      continue;
    }

    flushAsciiRun();
    estimate += 1;
  }

  flushAsciiRun();
  return Math.max(1, Math.ceil(estimate));
}

function estimateMessageTokens(message: ClaudeMessage): number {
  const contentTokens = estimateTextTokens(message.content || '');
  const thinkingTokens = message.thinking ? estimateTextTokens(message.thinking) : 0;
  const attachmentTokens = (message.images?.length || 0) * 128;
  return 12 + contentTokens + thinkingTokens + attachmentTokens;
}

export function estimateContextUsage(provider: Provider, messages: ClaudeMessage[]): SessionContextUsage {
  const budgetTokens = getContextBudgetTokens(provider);
  const estimatedTokens = messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
  const remainingTokens = Math.max(0, budgetTokens - estimatedTokens);
  const overflowTokens = Math.max(0, estimatedTokens - budgetTokens);
  const usedPercent = budgetTokens > 0
    ? Math.min(100, Math.round((estimatedTokens / budgetTokens) * 1000) / 10)
    : 0;
  const remainingPercent = Math.max(0, Math.round((remainingTokens / budgetTokens) * 1000) / 10);

  return {
    provider,
    budgetTokens,
    estimatedTokens,
    remainingTokens,
    overflowTokens,
    usedPercent,
    remainingPercent,
    isOverBudget: overflowTokens > 0,
    messageCount: messages.length,
    estimatedCharacters: messages.reduce((total, message) => total + countCodePoints(message.content || ''), 0),
    isEstimated: true
  };
}

export function estimateSessionContextUsage(session: Pick<ClaudeSession, 'provider' | 'messages'>): SessionContextUsage {
  return estimateContextUsage(session.provider, session.messages || []);
}

function truncateText(value: string, maxLength: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxLength) {
    return value;
  }

  return chars.slice(0, Math.max(0, maxLength - 1)).join('') + '…';
}

function summarizeMessage(message: ClaudeMessage, maxLength: number): string {
  const roleLabel = message.role === 'user' ? 'User' : 'Assistant';
  const content = truncateText(normalizeText(message.content || ''), maxLength).replace(/\s+/g, ' ');
  return content ? `${roleLabel}: ${content}` : `${roleLabel}: (empty)`;
}

export function buildCompactPrompt(
  session: Pick<ClaudeSession, 'title' | 'provider' | 'messages'>,
  options?: {
    recentMessageCount?: number;
    maxSummaryMessages?: number;
    maxPromptCharacters?: number;
  }
): CompactPromptResult {
  const messages = session.messages || [];
  const recentMessageCount = Math.max(2, options?.recentMessageCount || 6);
  const maxSummaryMessages = Math.max(4, options?.maxSummaryMessages || 12);
  const recentMessages = messages.slice(-recentMessageCount);
  const earlierMessages = messages.slice(0, Math.max(0, messages.length - recentMessages.length));
  const summarizedEarlierMessages = earlierMessages.slice(-maxSummaryMessages);
  const omittedEarlierMessages = Math.max(0, earlierMessages.length - summarizedEarlierMessages.length);

  const lines: string[] = [];
  lines.push(`Compacted context for ${session.title || 'New Chat'}.`);
  lines.push(`Provider: ${session.provider}`);
  lines.push('Goal: preserve decisions, constraints, file paths, identifiers, and open questions.');

  if (summarizedEarlierMessages.length > 0) {
    lines.push('');
    lines.push('Earlier context summary:');
    for (const message of summarizedEarlierMessages) {
      lines.push(`- ${summarizeMessage(message, 140)}`);
    }

    if (omittedEarlierMessages > 0) {
      lines.push(`- ... and ${omittedEarlierMessages} earlier message(s) omitted.`);
    }
  }

  if (recentMessages.length > 0) {
    lines.push('');
    lines.push('Recent context to preserve verbatim:');
    for (const message of recentMessages) {
      lines.push(`- ${summarizeMessage(message, 180)}`);
    }
  }

  lines.push('');
  lines.push('Acknowledge that the conversation has been compacted and continue from this compacted state.');

  const summary = lines.join('\n');
  const prompt = options?.maxPromptCharacters
    ? truncateText(summary, options.maxPromptCharacters)
    : summary;

  return {
    prompt,
    summary: prompt,
    summarizedMessages: earlierMessages.length,
    retainedMessages: recentMessages.length
  };
}
