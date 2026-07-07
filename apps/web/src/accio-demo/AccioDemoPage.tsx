import React, { startTransition, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ClipboardList,
  Factory,
  Loader2,
  SendHorizontal,
  ShieldAlert,
  Sparkles,
  Table2
} from 'lucide-react';
import { createAccioJob, loadAccioJob, submitAccioFollowUp, subscribeToAccioJob } from './api';
import { AccioJobEvent, InquiryTone, PriorityMode, ProcurementBrief, ProcurementJob } from './types';

interface FormState {
  productName: string;
  targetMarket: string;
  budgetRange: string;
  targetPrice: string;
  moqTarget: string;
  certifications: string;
  materials: string;
  specs: string;
  priorityMode: PriorityMode;
  inquiryTone: InquiryTone;
}

const DEFAULT_FORM: FormState = {
  productName: 'Insulated stainless steel water bottle',
  targetMarket: 'United States',
  budgetRange: 'Target factory cost near USD 3.20',
  targetPrice: '3.2',
  moqTarget: '500',
  certifications: 'FDA',
  materials: 'stainless steel, silicone',
  specs: 'double wall insulation, leak-resistant lid',
  priorityMode: 'balanced',
  inquiryTone: 'professional'
};

const STAGE_LABELS: Record<string, string> = {
  market_analysis: 'Market Analyst',
  requirements_normalization: 'Perfect Match',
  supplier_scout: 'Supplier Scout',
  compliance_review: 'Compliance Reviewer',
  procurement_writer: 'Procurement Writer',
  synthesizer: 'Synthesizer'
};

function splitList(raw: string): string[] {
  return raw
    .split(/,|\n/g)
    .map(item => item.trim())
    .filter(Boolean);
}

function buildBrief(form: FormState): ProcurementBrief {
  return {
    productName: form.productName.trim(),
    targetMarket: form.targetMarket.trim(),
    budgetRange: form.budgetRange.trim() || undefined,
    targetPrice: form.targetPrice.trim() ? Number.parseFloat(form.targetPrice) : undefined,
    moqTarget: form.moqTarget.trim() ? Number.parseInt(form.moqTarget, 10) : undefined,
    preferredLeadTimeDays: undefined,
    certifications: splitList(form.certifications),
    materials: splitList(form.materials),
    specs: splitList(form.specs),
    referenceLinks: [],
    referenceImages: [],
    priorityMode: form.priorityMode,
    inquiryTone: form.inquiryTone,
    notes: []
  };
}

function statusClass(status: string): string {
  switch (status) {
    case 'running':
      return 'border-amber-400/30 bg-amber-500/10 text-amber-100';
    case 'completed':
      return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100';
    case 'failed':
      return 'border-red-400/30 bg-red-500/10 text-red-100';
    default:
      return 'border-white/10 bg-white/5 text-white/60';
  }
}

export default function AccioDemoPage() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [job, setJob] = useState<ProcurementJob | null>(null);
  const [followUp, setFollowUp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const streamRef = useRef<EventSource | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!job?.id) {
      return;
    }

    streamRef.current?.close();
    const source = subscribeToAccioJob(
      job.id,
      (event: AccioJobEvent) => {
        startTransition(() => {
          setJob(event.job);
          if (event.type === 'job.completed' || event.type === 'job.failed') {
            setSubmitting(false);
          }
        });
      },
      async () => {
        try {
          const latest = await loadAccioJob(job.id);
          setJob(latest);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'Failed to reload job status.';
          setError(message);
        }
      }
    );
    streamRef.current = source;

    return () => source.close();
  }, [job?.id]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const created = await createAccioJob(buildBrief(form));
      setJob(created);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to start job.';
      setError(message);
      setSubmitting(false);
    }
  }

  async function onFollowUpSubmit() {
    if (!job || !followUp.trim()) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const next = await submitAccioFollowUp(job.id, followUp.trim());
      setJob(next);
      setFollowUp('');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to run follow-up.';
      setError(message);
      setSubmitting(false);
    }
  }

  return (
    <div className="h-screen overflow-hidden bg-[linear-gradient(180deg,#0a0a0a_0%,#0e1524_55%,#0a111a_100%)] text-white">
      <div className="mx-auto flex h-full max-w-[1520px] flex-col overflow-hidden px-5 py-5">
        <div className="mb-4 flex items-center justify-between gap-3 rounded-3xl border border-white/10 bg-white/5 px-5 py-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-amber-200/80">Local Demo</div>
            <h1 className="text-2xl font-semibold">Accio-like Procurement Agent</h1>
          </div>
          <button
            type="button"
            onClick={() => {
              window.location.hash = '';
            }}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/20 px-4 py-2 text-sm text-white/80 hover:bg-black/30"
          >
            <ArrowLeft size={16} />
            Back
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)_320px]">
          <section className="min-h-0 overflow-y-auto rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="mb-4 flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-white/50">
              <ClipboardList size={15} />
              Brief
            </div>
            <form className="space-y-3" onSubmit={onSubmit}>
              <input value={form.productName} onChange={e => setForm({ ...form, productName: e.target.value })} className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm outline-none focus:border-amber-300/35" placeholder="Product name" />
              <input value={form.targetMarket} onChange={e => setForm({ ...form, targetMarket: e.target.value })} className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm outline-none focus:border-amber-300/35" placeholder="Target market" />
              <input value={form.budgetRange} onChange={e => setForm({ ...form, budgetRange: e.target.value })} className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm outline-none focus:border-amber-300/35" placeholder="Budget range" />
              <div className="grid grid-cols-2 gap-2">
                <input value={form.targetPrice} onChange={e => setForm({ ...form, targetPrice: e.target.value })} className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm outline-none focus:border-amber-300/35" placeholder="Target price" />
                <input value={form.moqTarget} onChange={e => setForm({ ...form, moqTarget: e.target.value })} className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm outline-none focus:border-amber-300/35" placeholder="MOQ" />
              </div>
              <textarea value={form.certifications} onChange={e => setForm({ ...form, certifications: e.target.value })} rows={2} className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm outline-none focus:border-amber-300/35" placeholder="Certifications (comma-separated)" />
              <textarea value={form.materials} onChange={e => setForm({ ...form, materials: e.target.value })} rows={2} className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm outline-none focus:border-amber-300/35" placeholder="Materials" />
              <textarea value={form.specs} onChange={e => setForm({ ...form, specs: e.target.value })} rows={2} className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm outline-none focus:border-amber-300/35" placeholder="Specs" />
              <div className="grid grid-cols-2 gap-2">
                <select value={form.priorityMode} onChange={e => setForm({ ...form, priorityMode: e.target.value as PriorityMode })} className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm outline-none focus:border-amber-300/35">
                  <option value="balanced">Balanced</option>
                  <option value="low_price">Low Price</option>
                  <option value="quality">Quality</option>
                </select>
                <select value={form.inquiryTone} onChange={e => setForm({ ...form, inquiryTone: e.target.value as InquiryTone })} className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm outline-none focus:border-amber-300/35">
                  <option value="professional">Professional</option>
                  <option value="concise">Concise</option>
                  <option value="assertive">Assertive</option>
                </select>
              </div>
              {error && <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100">{error}</div>}
              <button type="submit" disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-3 text-sm font-semibold text-black disabled:opacity-65">
                {submitting ? <Loader2 size={16} className="animate-spin" /> : <SendHorizontal size={16} />}
                {submitting ? 'Running...' : 'Run Workflow'}
              </button>
            </form>
          </section>

          <section className="min-h-0 overflow-y-auto rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="mb-4 flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-white/50">
              <Factory size={15} />
              Results
            </div>
            {!job && <div className="rounded-2xl border border-dashed border-white/15 bg-black/15 px-4 py-5 text-sm text-white/60">Run a brief to generate market analysis, supplier shortlist, comparison, inquiry drafts, and risk notes.</div>}
            {job && (
              <div className="space-y-4">
                {job.result.executiveSummary && <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-6 text-white/80">{job.result.executiveSummary}</div>}
                {job.result.marketInsight && (
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-white/45">Market Insight</div>
                    <div className="mt-2 text-sm leading-6 text-white/80">{job.result.marketInsight.summary}</div>
                  </div>
                )}
                {job.result.supplierMatches && job.result.supplierMatches.length > 0 && (
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-white/45">Top Suppliers</div>
                    <div className="mt-2 space-y-2">
                      {job.result.supplierMatches.slice(0, 3).map(match => (
                        <div key={match.supplierId} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-semibold">{match.supplierName}</div>
                            <div className="text-xs text-emerald-200">{match.fitScore}/100</div>
                          </div>
                          <div className="mt-1 text-xs text-white/60">MOQ {match.minMoq} | Lead {match.leadTimeDays}d | Reliability {match.reliabilityScore}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {job.result.comparisonTable?.rows?.length ? (
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-white/45">
                      <Table2 size={14} />
                      Comparison
                    </div>
                    <div className="space-y-1 text-xs text-white/75">
                      {job.result.comparisonTable.rows.slice(0, 4).map(row => (
                        <div key={row.supplierId} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                          <span>{row.supplierName}</span>
                          <span>{row.fitScore} / MOQ {row.minMoq}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {job.result.inquiryDraft && (
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-white/45">Inquiry Draft ({job.brief.inquiryTone})</div>
                    <pre className="mt-2 whitespace-pre-wrap text-sm leading-6 text-white/80">{job.result.inquiryDraft[job.brief.inquiryTone]}</pre>
                  </div>
                )}
                {job.result.complianceNote && (
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                    <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-white/45">
                      <ShieldAlert size={14} />
                      Compliance Notes
                    </div>
                    <ul className="space-y-1 text-sm text-white/75">
                      {job.result.complianceNote.warnings.map(item => (
                        <li key={item}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="min-h-0 overflow-y-auto rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="mb-4 flex items-center gap-2 text-sm uppercase tracking-[0.18em] text-white/50">
              <Sparkles size={15} />
              Timeline
            </div>
            {!job && <div className="rounded-2xl border border-dashed border-white/15 bg-black/15 px-4 py-5 text-sm text-white/60">Stages will appear after job creation.</div>}
            {job && (
              <div className="space-y-3">
                <div className={`rounded-2xl border px-3 py-2 text-xs uppercase tracking-[0.16em] ${statusClass(job.status)}`}>{job.status}</div>
                {job.stages.map(stage => (
                  <div key={stage.name} className={`rounded-2xl border px-3 py-3 ${statusClass(stage.status)}`}>
                    <div className="text-sm font-semibold">{STAGE_LABELS[stage.name] || stage.name}</div>
                    <div className="mt-1 text-xs text-white/65">{stage.status}</div>
                    {stage.logs.length > 0 && <div className="mt-2 text-xs text-white/75">{stage.logs[stage.logs.length - 1].message}</div>}
                  </div>
                ))}
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="text-xs uppercase tracking-[0.16em] text-white/45">Follow-up</div>
                  <textarea value={followUp} onChange={e => setFollowUp(e.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-emerald-300/35" placeholder="Find lower MOQ suppliers and rewrite inquiry in assertive tone." />
                  <button type="button" disabled={!followUp.trim() || !job || submitting} onClick={onFollowUpSubmit} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
                    {submitting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                    Run follow-up
                  </button>
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
