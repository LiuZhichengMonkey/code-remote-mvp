import { AccioJobEvent, ProcurementBrief, ProcurementJob } from './types';

function resolveApiBase(): string {
  const configuredBase = (import.meta.env.VITE_ACCIO_API_BASE as string | undefined)?.trim();
  if (configuredBase) {
    return configuredBase.replace(/\/$/, '');
  }

  if (typeof window !== 'undefined' && window.location.port === '3001') {
    return 'http://127.0.0.1:8085';
  }

  return '';
}

const API_BASE = resolveApiBase();

function resolveAccessToken(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  const urlToken = new URLSearchParams(window.location.search).get('token');
  if (urlToken?.trim()) {
    return urlToken.trim();
  }

  const localToken = window.localStorage.getItem('coderemote_token') || '';
  if (localToken.trim()) {
    return localToken.trim();
  }

  const sessionToken = window.sessionStorage.getItem('coderemote_token_session') || '';
  return sessionToken.trim();
}

function withAccessHeaders(init: RequestInit = {}): RequestInit {
  const token = resolveAccessToken();
  const headers = new Headers(init.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return {
    ...init,
    headers
  };
}

function buildApiUrl(path: string): string {
  const token = resolveAccessToken();
  if (!token) {
    return `${API_BASE}${path}`;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${API_BASE}${path}${separator}token=${encodeURIComponent(token)}`;
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok) {
    const errorMessage = typeof payload?.error === 'string' ? payload.error : `Request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload as T;
}

export async function createAccioJob(brief: ProcurementBrief): Promise<ProcurementJob> {
  const response = await fetch(buildApiUrl('/api/accio-demo/jobs'), withAccessHeaders({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ brief })
  }));

  const payload = await parseJsonResponse<{ job: ProcurementJob }>(response);
  return payload.job;
}

export async function loadAccioJob(jobId: string): Promise<ProcurementJob> {
  const response = await fetch(buildApiUrl(`/api/accio-demo/jobs/${encodeURIComponent(jobId)}`), withAccessHeaders());
  const payload = await parseJsonResponse<{ job: ProcurementJob }>(response);
  return payload.job;
}

export async function submitAccioFollowUp(jobId: string, prompt: string): Promise<ProcurementJob> {
  const response = await fetch(buildApiUrl(`/api/accio-demo/jobs/${encodeURIComponent(jobId)}/follow-ups`), withAccessHeaders({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prompt })
  }));

  const payload = await parseJsonResponse<{ job: ProcurementJob }>(response);
  return payload.job;
}

export function subscribeToAccioJob(
  jobId: string,
  onEvent: (event: AccioJobEvent) => void,
  onError: (error: Event) => void
): EventSource {
  const source = new EventSource(buildApiUrl(`/api/accio-demo/jobs/${encodeURIComponent(jobId)}/events`));
  source.onmessage = (message) => {
    const payload = JSON.parse(message.data) as AccioJobEvent;
    onEvent(payload);
  };
  source.onerror = onError;
  return source;
}
