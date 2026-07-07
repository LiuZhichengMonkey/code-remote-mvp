export type PriorityMode = 'balanced' | 'low_price' | 'quality';
export type InquiryTone = 'professional' | 'concise' | 'assertive';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'needs_input';
export type JobStageStatus = 'pending' | 'running' | 'completed' | 'failed';
export type JobStageName =
  | 'market_analysis'
  | 'requirements_normalization'
  | 'supplier_scout'
  | 'compliance_review'
  | 'procurement_writer'
  | 'synthesizer';

export interface ProcurementBrief {
  productName: string;
  targetMarket: string;
  budgetRange?: string;
  targetPrice?: number;
  moqTarget?: number;
  preferredLeadTimeDays?: number;
  certifications: string[];
  materials: string[];
  specs: string[];
  referenceLinks: string[];
  referenceImages: string[];
  priorityMode: PriorityMode;
  inquiryTone: InquiryTone;
  notes: string[];
}

export interface MarketInsight {
  category: string;
  region: string;
  buyerProfile: string;
  positioning: string;
  recommendedPriceBand: string;
  valueProps: string[];
  risks: string[];
  summary: string;
}

export interface NormalizedRequirements {
  category: string;
  region: string;
  sourcingSummary: string;
  targetPriceBand: string;
  moqTarget: number;
  preferredLeadTimeDays: number;
  requiredCertifications: string[];
  desiredMaterials: string[];
  mustHaveSpecs: string[];
  openQuestions: string[];
  priorityMode: PriorityMode;
  inquiryTone: InquiryTone;
}

export interface SupplierMatch {
  supplierId: string;
  supplierName: string;
  region: string;
  fitScore: number;
  priceBand: string;
  minMoq: number;
  leadTimeDays: number;
  certifications: string[];
  customizationSupport: 'low' | 'medium' | 'high';
  reliabilityScore: number;
  pros: string[];
  cons: string[];
  recommendedFor: string[];
  missingInfo: string[];
  scoreBreakdown: Record<string, number>;
}

export interface ComparisonRow {
  supplierId: string;
  supplierName: string;
  region: string;
  fitScore: number;
  priceBand: string;
  minMoq: number;
  leadTimeDays: number;
  certifications: string[];
  reliabilityScore: number;
  customizationSupport: 'low' | 'medium' | 'high';
}

export interface ComparisonTable {
  rows: ComparisonRow[];
}

export interface InquiryDraft {
  professional: string;
  concise: string;
  assertive: string;
  checklist: string[];
}

export interface ComplianceNote {
  requiredCertifications: string[];
  warnings: string[];
  recommendedChecks: string[];
  importNotes: string[];
}

export interface ProcurementResult {
  marketInsight?: MarketInsight;
  normalizedRequirements?: NormalizedRequirements;
  supplierMatches?: SupplierMatch[];
  comparisonTable?: ComparisonTable;
  inquiryDraft?: InquiryDraft;
  complianceNote?: ComplianceNote;
  executiveSummary?: string;
}

export interface JobStageLog {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface JobStage {
  name: JobStageName;
  status: JobStageStatus;
  startedAt?: number;
  completedAt?: number;
  logs: JobStageLog[];
}

export interface ProcurementJob {
  id: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  parentJobId?: string;
  followUpPrompt?: string;
  brief: ProcurementBrief;
  stages: JobStage[];
  result: ProcurementResult;
  errorMessage?: string;
}

export interface AccioJobEvent {
  type: string;
  timestamp: number;
  jobId: string;
  stageName?: JobStageName;
  message?: string;
  job: ProcurementJob;
}
