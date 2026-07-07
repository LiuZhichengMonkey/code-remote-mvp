import { MARKET_SIGNALS } from '../catalog/marketSignals';
import {
  classifyTargetMarket,
  detectCategory,
  inferBuyerProfile,
  inferRecommendedPriceBand
} from '../heuristics';
import { MarketInsight, ProcurementBrief } from '../types';

export class MarketAnalystAgent {
  run(brief: ProcurementBrief): MarketInsight {
    const category = detectCategory(brief.productName, [...brief.specs, ...brief.materials]);
    const region = classifyTargetMarket(brief.targetMarket);
    const signal = MARKET_SIGNALS.find(entry => entry.category === category && entry.region === region)
      || MARKET_SIGNALS.find(entry => entry.category === category && entry.region === 'global');

    const valueProps = signal?.valueProps || [
      'clear differentiation from commodity listings',
      'focused assortment with strong hero SKU',
      'repeatable sourcing specs for stable replenishment'
    ];
    const risks = signal?.risks || [
      'unclear product-market fit without sharper positioning',
      'margin pressure if the offer looks too generic'
    ];

    return {
      category,
      region,
      buyerProfile: inferBuyerProfile(category),
      positioning: signal?.positioning || 'Position around practical value, consistent quality, and easy supplier qualification.',
      recommendedPriceBand: inferRecommendedPriceBand(category),
      valueProps,
      risks,
      summary: `${brief.productName} fits the ${category.replace(/_/g, ' ')} lane for ${brief.targetMarket}. Lead with ${valueProps[0]} and validate supplier consistency early.`
    };
  }
}
