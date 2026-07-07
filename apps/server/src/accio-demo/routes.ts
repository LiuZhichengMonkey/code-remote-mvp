import { IncomingMessage, ServerResponse } from 'http';
import { SUPPLIER_CATALOG } from './catalog/suppliers';
import {
  coerceInquiryTone,
  normalizeList
} from './heuristics';
import { AccioDemoOrchestrator } from './orchestrator';
import { AccioDemoJobStore } from './storage/jobStore';
import {
  CreateJobRequest,
  FollowUpRequest,
  PriorityMode,
  ProcurementBrief
} from './types';

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  return (raw ? JSON.parse(raw) : {}) as T;
}

async function safeReadJsonBody<T>(req: IncomingMessage): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    const value = await readJsonBody<T>(req);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function coercePriorityMode(value: unknown): PriorityMode {
  if (value === 'low_price' || value === 'quality') {
    return value;
  }

  return 'balanced';
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function normalizeBrief(input: Partial<ProcurementBrief>): ProcurementBrief {
  return {
    productName: (input.productName || '').trim(),
    targetMarket: (input.targetMarket || '').trim(),
    budgetRange: (input.budgetRange || '').trim() || undefined,
    targetPrice: parseNumber(input.targetPrice),
    moqTarget: parseNumber(input.moqTarget),
    preferredLeadTimeDays: parseNumber(input.preferredLeadTimeDays),
    certifications: normalizeList(input.certifications),
    materials: normalizeList(input.materials),
    specs: normalizeList(input.specs),
    referenceLinks: normalizeList(input.referenceLinks),
    referenceImages: normalizeList(input.referenceImages),
    priorityMode: coercePriorityMode(input.priorityMode),
    inquiryTone: coerceInquiryTone(input.inquiryTone),
    notes: normalizeList(input.notes)
  };
}

export class AccioDemoRouter {
  private readonly jobStore = new AccioDemoJobStore();
  private readonly orchestrator = new AccioDemoOrchestrator(
    this.jobStore,
    process.env.NODE_ENV === 'test' ? 0 : 180
  );

  canHandle(pathname: string): boolean {
    return pathname.startsWith('/api/accio-demo/');
  }

  async handle(req: IncomingMessage, res: ServerResponse, requestUrl: URL): Promise<boolean> {
    const pathname = requestUrl.pathname;

    if (pathname === '/api/accio-demo/catalog/suppliers' && req.method === 'GET') {
      sendJson(res, 200, { suppliers: SUPPLIER_CATALOG });
      return true;
    }

    if (pathname === '/api/accio-demo/jobs' && req.method === 'POST') {
      const parsedBody = await safeReadJsonBody<CreateJobRequest>(req);
      if (!parsedBody.ok) {
        sendJson(res, 400, { error: 'Invalid JSON body.' });
        return true;
      }

      const brief = normalizeBrief(parsedBody.value.brief || {});

      if (!brief.productName || !brief.targetMarket) {
        sendJson(res, 400, { error: 'productName and targetMarket are required.' });
        return true;
      }

      const job = this.orchestrator.createJob(brief);
      void this.orchestrator.runJob(job.id);
      sendJson(res, 202, { job });
      return true;
    }

    const jobMatch = pathname.match(/^\/api\/accio-demo\/jobs\/([^/]+)$/);
    if (jobMatch && req.method === 'GET') {
      const jobId = decodeURIComponent(jobMatch[1]);
      const job = this.jobStore.getJob(jobId);
      if (!job) {
        sendJson(res, 404, { error: 'Job not found.' });
        return true;
      }

      sendJson(res, 200, { job });
      return true;
    }

    const followUpMatch = pathname.match(/^\/api\/accio-demo\/jobs\/([^/]+)\/follow-ups$/);
    if (followUpMatch && req.method === 'POST') {
      const jobId = decodeURIComponent(followUpMatch[1]);
      const parsedBody = await safeReadJsonBody<FollowUpRequest>(req);
      if (!parsedBody.ok) {
        sendJson(res, 400, { error: 'Invalid JSON body.' });
        return true;
      }

      const payload = parsedBody.value;
      if (!payload.prompt || !payload.prompt.trim()) {
        sendJson(res, 400, { error: 'Follow-up prompt is required.' });
        return true;
      }

      const nextJob = this.orchestrator.createFollowUpJob(jobId, payload.prompt.trim());
      if (!nextJob) {
        sendJson(res, 404, { error: 'Parent job not found.' });
        return true;
      }

      void this.orchestrator.runJob(nextJob.id);
      sendJson(res, 202, { job: nextJob });
      return true;
    }

    const eventsMatch = pathname.match(/^\/api\/accio-demo\/jobs\/([^/]+)\/events$/);
    if (eventsMatch && req.method === 'GET') {
      const jobId = decodeURIComponent(eventsMatch[1]);
      const job = this.jobStore.getJob(jobId);
      if (!job) {
        sendJson(res, 404, { error: 'Job not found.' });
        return true;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive'
      });
      res.write(`data: ${JSON.stringify({ type: 'job.snapshot', job })}\n\n`);

      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 15000);

      const listener = (event: unknown) => {
        const typedEvent = event as { jobId: string };
        if (typedEvent.jobId !== jobId) {
          return;
        }

        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      this.jobStore.on('event', listener);
      req.on('close', () => {
        clearInterval(heartbeat);
        this.jobStore.off('event', listener);
        res.end();
      });
      return true;
    }

    return false;
  }
}
