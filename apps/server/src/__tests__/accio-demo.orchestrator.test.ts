import { AccioDemoOrchestrator } from '../accio-demo/orchestrator';
import { AccioDemoJobStore } from '../accio-demo/storage/jobStore';
import { ProcurementBrief } from '../accio-demo/types';

describe('accio demo orchestrator', () => {
  const baseBrief: ProcurementBrief = {
    productName: 'insulated water bottle',
    targetMarket: 'United States',
    budgetRange: 'Target factory cost near USD 3.20',
    targetPrice: 3.2,
    moqTarget: 500,
    preferredLeadTimeDays: 25,
    certifications: ['FDA'],
    materials: ['stainless steel'],
    specs: ['double wall insulation'],
    referenceLinks: [],
    referenceImages: [],
    priorityMode: 'balanced',
    inquiryTone: 'professional',
    notes: []
  };

  test('runs a procurement job to completion with structured outputs', async () => {
    const store = new AccioDemoJobStore();
    const orchestrator = new AccioDemoOrchestrator(store, 0);
    const job = orchestrator.createJob(baseBrief);

    await orchestrator.runJob(job.id);

    const completed = store.getJob(job.id);
    expect(completed?.status).toBe('completed');
    expect(completed?.result.marketInsight?.category).toBe('drinkware');
    expect(completed?.result.supplierMatches?.length).toBeGreaterThan(0);
    expect(completed?.result.inquiryDraft?.professional).toContain('MOQ around 500 units');
    expect(completed?.result.comparisonTable?.rows.length).toBeGreaterThan(0);
  });

  test('creates a follow-up job with updated MOQ preferences', () => {
    const store = new AccioDemoJobStore();
    const orchestrator = new AccioDemoOrchestrator(store, 0);
    const job = orchestrator.createJob(baseBrief);

    const followUp = orchestrator.createFollowUpJob(job.id, 'Find lower MOQ suppliers and rewrite the inquiry in a stronger tone');

    expect(followUp).toBeTruthy();
    expect(followUp?.parentJobId).toBe(job.id);
    expect(followUp?.brief.moqTarget).toBeLessThan(baseBrief.moqTarget || 0);
    expect(followUp?.brief.inquiryTone).toBe('assertive');
  });
});
