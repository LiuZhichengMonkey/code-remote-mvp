export type PriorityMode = 'balanced' | 'low_price' | 'quality';
export type InquiryTone = 'professional' | 'concise' | 'assertive';

export type ProductCategory =
  | 'drinkware'
  | 'fitness'
  | 'pet'
  | 'home_storage'
  | 'beauty_tools'
  | 'electronics_accessories'
  | 'home_textiles'
  | 'kitchenware'
  | 'general_merchandise';

export type TargetMarketRegion =
  | 'north_america'
  | 'europe'
  | 'middle_east'
  | 'southeast_asia'
  | 'global';

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
  category: ProductCategory;
  region: TargetMarketRegion;
  buyerProfile: string;
  positioning: string;
  recommendedPriceBand: string;
  valueProps: string[];
  risks: string[];
  summary: string;
}

export interface NormalizedRequirements {
  category: ProductCategory;
  region: TargetMarketRegion;
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

export interface SupplierProfile {
  supplierId: string;
  name: string;
  region: string;
  categories: ProductCategory[];
  productKeywords: string[];
  priceBand: string;
  minMoq: number;
  leadTimeDays: number;
  sampleLeadTimeDays: number;
  certifications: string[];
  materials: string[];
  customizationSupport: 'low' | 'medium' | 'high';
  reliabilityScore: number;
  strengths: string[];
  notes: string;
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
  customizationSupport: SupplierProfile['customizationSupport'];
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
  customizationSupport: SupplierProfile['customizationSupport'];
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

export type JobStageName =
  | 'market_analysis'
  | 'requirements_normalization'
  | 'supplier_scout'
  | 'compliance_review'
  | 'procurement_writer'
  | 'synthesizer';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'needs_input';
export type JobStageStatus = 'pending' | 'running' | 'completed' | 'failed';
export type JobLogLevel = 'info' | 'warn' | 'error';

export interface JobStageLog {
  timestamp: number;
  level: JobLogLevel;
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
  type:
    | 'job.snapshot'
    | 'job.started'
    | 'job.stage.updated'
    | 'job.stage.completed'
    | 'job.completed'
    | 'job.failed';
  timestamp: number;
  jobId: string;
  job: ProcurementJob;
  stageName?: JobStageName;
  message?: string;
}

export interface CreateJobRequest {
  brief: ProcurementBrief;
}

export interface FollowUpRequest {
  prompt: string;
}
