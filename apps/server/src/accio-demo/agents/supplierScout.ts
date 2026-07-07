import { SUPPLIER_CATALOG } from '../catalog/suppliers';
import { scoreSupplier } from '../scoring/supplierScoring';
import { NormalizedRequirements, SupplierMatch, SupplierProfile } from '../types';

function buildSupplierPros(supplier: SupplierProfile, requirements: NormalizedRequirements): string[] {
  const pros: string[] = [];

  if (supplier.categories.includes(requirements.category)) {
    pros.push('Category specialization matches the sourcing brief.');
  }

  if (supplier.minMoq <= requirements.moqTarget) {
    pros.push(`MOQ ${supplier.minMoq} is within the requested target.`);
  }

  if (supplier.leadTimeDays <= requirements.preferredLeadTimeDays) {
    pros.push(`Lead time ${supplier.leadTimeDays} days is aligned with the launch window.`);
  }

  if (requirements.requiredCertifications.every(certification => supplier.certifications.includes(certification))) {
    pros.push('Certification coverage meets the current compliance baseline.');
  }

  pros.push(...supplier.strengths.slice(0, 2));
  return pros.slice(0, 4);
}

function buildSupplierCons(supplier: SupplierProfile, requirements: NormalizedRequirements): string[] {
  const cons: string[] = [];

  if (supplier.minMoq > requirements.moqTarget) {
    cons.push(`MOQ ${supplier.minMoq} is above the preferred target of ${requirements.moqTarget}.`);
  }

  if (supplier.leadTimeDays > requirements.preferredLeadTimeDays) {
    cons.push(`Lead time ${supplier.leadTimeDays} days may compress launch readiness.`);
  }

  const missingCertifications = requirements.requiredCertifications.filter(certification => !supplier.certifications.includes(certification));
  if (missingCertifications.length > 0) {
    cons.push(`Missing or unverified certifications: ${missingCertifications.join(', ')}.`);
  }

  if (supplier.customizationSupport === 'low') {
    cons.push('Limited customization support for private-label iterations.');
  }

  return cons.slice(0, 3);
}

export class SupplierScoutAgent {
  run(requirements: NormalizedRequirements): SupplierMatch[] {
    const filtered = SUPPLIER_CATALOG
      .filter(supplier => supplier.categories.includes(requirements.category))
      .map(supplier => {
        const score = scoreSupplier(supplier, requirements);
        const missingInfo = requirements.mustHaveSpecs.length > 0
          ? [`Validate supplier support for: ${requirements.mustHaveSpecs.join(', ')}.`]
          : ['Validate sample quality before placing the first bulk PO.'];

        return {
          supplierId: supplier.supplierId,
          supplierName: supplier.name,
          region: supplier.region,
          fitScore: score.total,
          priceBand: supplier.priceBand,
          minMoq: supplier.minMoq,
          leadTimeDays: supplier.leadTimeDays,
          certifications: supplier.certifications,
          customizationSupport: supplier.customizationSupport,
          reliabilityScore: supplier.reliabilityScore,
          pros: buildSupplierPros(supplier, requirements),
          cons: buildSupplierCons(supplier, requirements),
          recommendedFor: supplier.strengths.slice(0, 2),
          missingInfo,
          scoreBreakdown: score.breakdown
        } satisfies SupplierMatch;
      })
      .sort((left, right) => right.fitScore - left.fitScore)
      .slice(0, 6);

    if (filtered.length > 0) {
      return filtered;
    }

    return SUPPLIER_CATALOG
      .map(supplier => {
        const score = scoreSupplier(supplier, requirements);
        return {
          supplierId: supplier.supplierId,
          supplierName: supplier.name,
          region: supplier.region,
          fitScore: Math.max(30, score.total - 20),
          priceBand: supplier.priceBand,
          minMoq: supplier.minMoq,
          leadTimeDays: supplier.leadTimeDays,
          certifications: supplier.certifications,
          customizationSupport: supplier.customizationSupport,
          reliabilityScore: supplier.reliabilityScore,
          pros: ['Broader fallback supplier outside the exact category match.'],
          cons: ['Category alignment is weaker than ideal for this brief.'],
          recommendedFor: supplier.strengths.slice(0, 2),
          missingInfo: ['Manual product qualification is required.'],
          scoreBreakdown: score.breakdown
        } satisfies SupplierMatch;
      })
      .sort((left, right) => right.fitScore - left.fitScore)
      .slice(0, 4);
  }
}
