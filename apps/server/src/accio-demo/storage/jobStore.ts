import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  AccioJobEvent,
  JobLogLevel,
  JobStage,
  JobStageName,
  JobStatus,
  ProcurementBrief,
  ProcurementJob,
  ProcurementResult
} from '../types';

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const STAGE_ORDER: JobStageName[] = [
  'market_analysis',
  'requirements_normalization',
  'supplier_scout',
  'compliance_review',
  'procurement_writer',
  'synthesizer'
];

function createStages(): JobStage[] {
  return STAGE_ORDER.map(name => ({
    name,
    status: 'pending',
    logs: []
  }));
}

export class AccioDemoJobStore extends EventEmitter {
  private readonly jobs = new Map<string, ProcurementJob>();

  createJob(brief: ProcurementBrief, options?: { parentJobId?: string; followUpPrompt?: string }): ProcurementJob {
    const now = Date.now();
    const job: ProcurementJob = {
      id: uuidv4(),
      status: 'queued',
      createdAt: now,
      updatedAt: now,
      parentJobId: options?.parentJobId,
      followUpPrompt: options?.followUpPrompt,
      brief,
      stages: createStages(),
      result: {}
    };

    this.jobs.set(job.id, job);
    this.emitEvent({
      type: 'job.snapshot',
      timestamp: now,
      jobId: job.id,
      job: cloneValue(job)
    });
    return cloneValue(job);
  }

  getJob(jobId: string): ProcurementJob | null {
    const job = this.jobs.get(jobId);
    return job ? cloneValue(job) : null;
  }

  listJobs(): ProcurementJob[] {
    return Array.from(this.jobs.values()).map(job => cloneValue(job));
  }

  setJobStatus(jobId: string, status: JobStatus, message?: string) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    job.status = status;
    job.updatedAt = Date.now();
    this.emitEvent({
      type: status === 'completed'
        ? 'job.completed'
        : status === 'failed'
          ? 'job.failed'
          : 'job.started',
      timestamp: job.updatedAt,
      jobId,
      job: cloneValue(job),
      message
    });
  }

  mergeResult(jobId: string, partial: ProcurementResult) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    job.result = {
      ...job.result,
      ...partial
    };
    job.updatedAt = Date.now();
    this.emitSnapshot(jobId);
  }

  startStage(jobId: string, stageName: JobStageName, message: string) {
    const stage = this.getMutableStage(jobId, stageName);
    const job = this.jobs.get(jobId);
    if (!stage || !job) {
      return;
    }

    stage.status = 'running';
    stage.startedAt = Date.now();
    stage.logs.push({
      timestamp: stage.startedAt,
      level: 'info',
      message
    });
    job.updatedAt = stage.startedAt;
    this.emitEvent({
      type: 'job.stage.updated',
      timestamp: job.updatedAt,
      jobId,
      job: cloneValue(job),
      stageName,
      message
    });
  }

  logStage(jobId: string, stageName: JobStageName, level: JobLogLevel, message: string) {
    const stage = this.getMutableStage(jobId, stageName);
    const job = this.jobs.get(jobId);
    if (!stage || !job) {
      return;
    }

    const timestamp = Date.now();
    stage.logs.push({
      timestamp,
      level,
      message
    });
    job.updatedAt = timestamp;
    this.emitEvent({
      type: 'job.stage.updated',
      timestamp,
      jobId,
      job: cloneValue(job),
      stageName,
      message
    });
  }

  completeStage(jobId: string, stageName: JobStageName, message: string) {
    const stage = this.getMutableStage(jobId, stageName);
    const job = this.jobs.get(jobId);
    if (!stage || !job) {
      return;
    }

    stage.status = 'completed';
    stage.completedAt = Date.now();
    stage.logs.push({
      timestamp: stage.completedAt,
      level: 'info',
      message
    });
    job.updatedAt = stage.completedAt;
    this.emitEvent({
      type: 'job.stage.completed',
      timestamp: job.updatedAt,
      jobId,
      job: cloneValue(job),
      stageName,
      message
    });
  }

  failJob(jobId: string, message: string, stageName?: JobStageName) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    if (stageName) {
      const stage = this.getMutableStage(jobId, stageName);
      if (stage) {
        stage.status = 'failed';
        stage.completedAt = Date.now();
        stage.logs.push({
          timestamp: stage.completedAt,
          level: 'error',
          message
        });
      }
    }

    job.status = 'failed';
    job.updatedAt = Date.now();
    job.errorMessage = message;
    this.emitEvent({
      type: 'job.failed',
      timestamp: job.updatedAt,
      jobId,
      job: cloneValue(job),
      stageName,
      message
    });
  }

  private emitSnapshot(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    this.emitEvent({
      type: 'job.snapshot',
      timestamp: Date.now(),
      jobId,
      job: cloneValue(job)
    });
  }

  private emitEvent(event: AccioJobEvent) {
    this.emit('event', event);
  }

  private getMutableStage(jobId: string, stageName: JobStageName): JobStage | null {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }

    return job.stages.find(stage => stage.name === stageName) || null;
  }
}
