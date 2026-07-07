import {
  classifyTargetMarket,
  detectCategory,
  inferBaselineCertifications,
  inferRecommendedPriceBand
} from '../heuristics';
import { MarketInsight, NormalizedRequirements, ProcurementBrief } from '../types';

export class RequirementsNormalizerAgent {
  run(brief: ProcurementBrief, marketInsight: MarketInsight): NormalizedRequirements {
    const category = detectCategory(brief.productName, [...brief.specs, ...brief.materials]);
    const region = classifyTargetMarket(brief.targetMarket);
    const requiredCertifications = Array.from(new Set([
      ...brief.certifications,
      ...inferBaselineCertifications(category, region)
    ]));
    const targetPriceBand = brief.targetPrice
      ? `Target factory cost near USD ${brief.targetPrice.toFixed(2)}`
      : (brief.budgetRange || marketInsight.recommendedPriceBand || inferRecommendedPriceBand(category));
    const moqTarget = brief.moqTarget && brief.moqTarget > 0 ? brief.moqTarget : 600;
    const preferredLeadTimeDays = brief.preferredLeadTimeDays && brief.preferredLeadTimeDays > 0
      ? brief.preferredLeadTimeDays
      : 25;
    const openQuestions: string[] = [];

    if (!brief.targetPrice && !brief.budgetRange) {
      openQuestions.push('Confirm the acceptable factory cost or landed price target.');
    }

    if (brief.materials.length === 0) {
      openQuestions.push('Confirm the must-have material or finish expectations.');
    }

    return {
      category,
      region,
      sourcingSummary: `Source ${brief.productName} for ${brief.targetMarket} with a ${brief.priorityMode.replace('_', ' ')} priority and supplier screening focused on certifications, MOQ, and repeat-order reliability.`,
      targetPriceBand,
      moqTarget,
      preferredLeadTimeDays,
      requiredCertifications,
      desiredMaterials: brief.materials,
      mustHaveSpecs: brief.specs,
      openQuestions,
      priorityMode: brief.priorityMode,
      inquiryTone: brief.inquiryTone
    };
  }
}
