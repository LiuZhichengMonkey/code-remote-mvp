import { MarketAnalystAgent } from './agents/marketAnalyst';
import { RequirementsNormalizerAgent } from './agents/requirementsNormalizer';
import { SupplierScoutAgent } from './agents/supplierScout';
import { ComplianceReviewerAgent } from './agents/complianceReviewer';
import { ProcurementWriterAgent } from './agents/procurementWriter';
import { applyFollowUpToBrief } from './heuristics';
import { AccioDemoJobStore } from './storage/jobStore';
import {
  ComparisonTable,
  JobStageName,
  ProcurementBrief,
  ProcurementJob
} from './types';

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildComparisonTable(job: ProcurementJob): ComparisonTable {
  const rows = (job.result.supplierMatches || []).map(match => ({
    supplierId: match.supplierId,
    supplierName: match.supplierName,
    region: match.region,
    fitScore: match.fitScore,
    priceBand: match.priceBand,
    minMoq: match.minMoq,
    leadTimeDays: match.leadTimeDays,
    certifications: match.certifications,
    reliabilityScore: match.reliabilityScore,
    customizationSupport: match.customizationSupport
  }));

  return { rows };
}

function buildExecutiveSummary(job: ProcurementJob): string {
  const topSupplier = job.result.supplierMatches?.[0];
  const marketSummary = job.result.marketInsight?.summary || 'Market insight unavailable.';
  const requirements = job.result.normalizedRequirements;

  if (!topSupplier || !requirements) {
    return marketSummary;
  }

  return [
    marketSummary,
    `Top supplier fit is ${topSupplier.supplierName} at ${topSupplier.fitScore}/100 with MOQ ${topSupplier.minMoq} and lead time ${topSupplier.leadTimeDays} days.`,
    `The current sourcing baseline expects ${requirements.requiredCertifications.join(', ') || 'standard documentation'} and a ${requirements.priorityMode.replace('_', ' ')} ranking mode.`
  ].join(' ');
}

export class AccioDemoOrchestrator {
  private readonly marketAnalyst = new MarketAnalystAgent();
  private readonly requirementsNormalizer = new RequirementsNormalizerAgent();
  private readonly supplierScout = new SupplierScoutAgent();
  private readonly complianceReviewer = new ComplianceReviewerAgent();
  private readonly procurementWriter = new ProcurementWriterAgent();

  constructor(
    private readonly jobStore: AccioDemoJobStore,
    private readonly stageDelayMs: number = 180
  ) {}

  createJob(brief: ProcurementBrief, options?: { parentJobId?: string; followUpPrompt?: string }): ProcurementJob {
    return this.jobStore.createJob(brief, options);
  }

  createFollowUpJob(jobId: string, prompt: string): ProcurementJob | null {
    const parentJob = this.jobStore.getJob(jobId);
    if (!parentJob) {
      return null;
    }

    const nextBrief = applyFollowUpToBrief(parentJob.brief, prompt);
    return this.createJob(nextBrief, {
      parentJobId: jobId,
      followUpPrompt: prompt
    });
  }

  async runJob(jobId: string): Promise<void> {
    const job = this.jobStore.getJob(jobId);
    if (!job) {
      return;
    }

    this.jobStore.setJobStatus(jobId, 'running', 'Procurement workflow started.');

    try {
      const marketInsight = await this.runStage(jobId, 'market_analysis', 'Researching product-market fit...', async () => {
        return this.marketAnalyst.run(job.brief);
      });
      this.jobStore.mergeResult(jobId, { marketInsight });

      const normalizedRequirements = await this.runStage(jobId, 'requirements_normalization', 'Normalizing sourcing requirements...', async () => {
        return this.requirementsNormalizer.run(job.brief, marketInsight);
      });
      this.jobStore.mergeResult(jobId, { normalizedRequirements });

      const supplierMatches = await this.runStage(jobId, 'supplier_scout', 'Scoring local supplier candidates...', async () => {
        return this.supplierScout.run(normalizedRequirements);
      });
      this.jobStore.mergeResult(jobId, { supplierMatches });

      const [complianceNote, inquiryDraft] = await Promise.all([
        this.runStage(jobId, 'compliance_review', 'Reviewing market-entry and sourcing risks...', async () => {
          return this.complianceReviewer.run(normalizedRequirements);
        }),
        this.runStage(jobId, 'procurement_writer', 'Drafting supplier outreach...', async () => {
          return this.procurementWriter.run(normalizedRequirements, supplierMatches);
        })
      ]);
      this.jobStore.mergeResult(jobId, { complianceNote, inquiryDraft });

      await this.runStage(jobId, 'synthesizer', 'Combining outputs into a sourcing brief...', async () => {
        const latestJob = this.jobStore.getJob(jobId);
        if (!latestJob) {
          throw new Error('Job disappeared during synthesis.');
        }

        return {
          comparisonTable: buildComparisonTable(latestJob),
          executiveSummary: buildExecutiveSummary(latestJob)
        };
      }).then(partial => this.jobStore.mergeResult(jobId, partial));

      this.jobStore.setJobStatus(jobId, 'completed', 'Procurement workflow completed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown procurement workflow error.';
      this.jobStore.failJob(jobId, message);
    }
  }

  private async runStage<T>(
    jobId: string,
    stageName: JobStageName,
    startMessage: string,
    task: () => Promise<T> | T
  ): Promise<T> {
    this.jobStore.startStage(jobId, stageName, startMessage);
    if (this.stageDelayMs > 0) {
      await wait(this.stageDelayMs);
    }

    try {
      const result = await task();
      this.jobStore.completeStage(jobId, stageName, 'Stage completed.');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown stage failure.';
      this.jobStore.failJob(jobId, message, stageName);
      throw error;
    }
  }
}
