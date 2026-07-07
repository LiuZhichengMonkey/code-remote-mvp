import { SupplierProfile, NormalizedRequirements, PriorityMode } from '../types';

export interface SupplierScoreResult {
  total: number;
  breakdown: Record<string, number>;
}

const PRIORITY_WEIGHTS: Record<PriorityMode, Record<string, number>> = {
  balanced: {
    category: 0.22,
    certification: 0.16,
    price: 0.2,
    moq: 0.16,
    leadTime: 0.12,
    reliability: 0.14
  },
  low_price: {
    category: 0.18,
    certification: 0.1,
    price: 0.32,
    moq: 0.18,
    leadTime: 0.08,
    reliability: 0.14
  },
  quality: {
    category: 0.2,
    certification: 0.22,
    price: 0.1,
    moq: 0.1,
    leadTime: 0.12,
    reliability: 0.26
  }
};

function parsePriceBandMidpoint(priceBand: string): number {
  const values = Array.from(priceBand.matchAll(/(\d+(?:\.\d+)?)/g)).map(match => Number.parseFloat(match[1]));
  if (values.length === 0) {
    return 0;
  }

  if (values.length === 1) {
    return values[0];
  }

  return (values[0] + values[1]) / 2;
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function scoreSupplier(
  supplier: SupplierProfile,
  requirements: NormalizedRequirements
): SupplierScoreResult {
  const weights = PRIORITY_WEIGHTS[requirements.priorityMode];
  const requiredCertifications = requirements.requiredCertifications;
  const supplierPriceMid = parsePriceBandMidpoint(supplier.priceBand);
  const priceTarget = requirements.targetPriceBand.match(/(\d+(?:\.\d+)?)/)
    ? Number.parseFloat(requirements.targetPriceBand.match(/(\d+(?:\.\d+)?)/)?.[1] || '0')
    : 0;

  const categoryScore = supplier.categories.includes(requirements.category) ? 100 : 45;
  const matchedCertifications = requiredCertifications.filter(certification => supplier.certifications.includes(certification));
  const certificationScore = requiredCertifications.length === 0
    ? 75
    : clampPercentage((matchedCertifications.length / requiredCertifications.length) * 100);
  const priceScore = priceTarget <= 0
    ? 75
    : clampPercentage(100 - (Math.abs(supplierPriceMid - priceTarget) / Math.max(priceTarget, 1)) * 100);
  const moqScore = clampPercentage(100 - ((supplier.minMoq - requirements.moqTarget) / Math.max(requirements.moqTarget, 1)) * 100);
  const leadTimeScore = clampPercentage(100 - ((supplier.leadTimeDays - requirements.preferredLeadTimeDays) / Math.max(requirements.preferredLeadTimeDays, 1)) * 100);
  const reliabilityScore = supplier.reliabilityScore;

  const breakdown = {
    category: Math.round(categoryScore),
    certification: Math.round(certificationScore),
    price: Math.round(priceScore),
    moq: Math.round(moqScore),
    leadTime: Math.round(leadTimeScore),
    reliability: Math.round(reliabilityScore)
  };

  const total = Math.round(
    breakdown.category * weights.category
    + breakdown.certification * weights.certification
    + breakdown.price * weights.price
    + breakdown.moq * weights.moq
    + breakdown.leadTime * weights.leadTime
    + breakdown.reliability * weights.reliability
  );

  return {
    total,
    breakdown
  };
}
