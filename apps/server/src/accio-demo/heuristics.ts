import {
  InquiryTone,
  ProcurementBrief,
  ProductCategory,
  TargetMarketRegion
} from './types';

const CATEGORY_KEYWORDS: Record<ProductCategory, string[]> = {
  drinkware: ['bottle', 'tumbler', 'mug', 'flask', 'cup', 'drinkware'],
  fitness: ['yoga', 'fitness', 'workout', 'gym', 'resistance', 'mat', 'band'],
  pet: ['pet', 'dog', 'cat', 'feeder', 'bowl', 'toy', 'litter'],
  home_storage: ['organizer', 'storage', 'bin', 'basket', 'drawer', 'shelf', 'container'],
  beauty_tools: ['beauty', 'makeup', 'brush', 'skincare', 'mirror', 'massager', 'comb'],
  electronics_accessories: ['charger', 'cable', 'power bank', 'case', 'stand', 'earbud', 'keyboard', 'mouse'],
  home_textiles: ['blanket', 'pillow', 'bedding', 'towel', 'sheet', 'linen', 'textile'],
  kitchenware: ['kitchen', 'utensil', 'lunch box', 'cookware', 'pan', 'knife', 'food container'],
  general_merchandise: []
};

export function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeList(values: unknown): string[] {
  if (Array.isArray(values)) {
    return values
      .map(value => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
  }

  if (typeof values === 'string') {
    return values
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
  }

  return [];
}

export function detectCategory(productName: string, extraTerms: string[] = []): ProductCategory {
  const haystack = [productName, ...extraTerms].map(normalizeText).join(' ');

  let bestCategory: ProductCategory = 'general_merchandise';
  let bestScore = 0;

  (Object.entries(CATEGORY_KEYWORDS) as Array<[ProductCategory, string[]]>).forEach(([category, keywords]) => {
    const score = keywords.reduce((total, keyword) => total + (haystack.includes(keyword) ? 1 : 0), 0);
    if (score > bestScore) {
      bestCategory = category;
      bestScore = score;
    }
  });

  return bestCategory;
}

export function classifyTargetMarket(targetMarket: string): TargetMarketRegion {
  const normalized = normalizeText(targetMarket);

  if (normalized.includes('us') || normalized.includes('usa') || normalized.includes('canada') || normalized.includes('north america')) {
    return 'north_america';
  }

  if (normalized.includes('eu') || normalized.includes('europe') || normalized.includes('germany') || normalized.includes('france') || normalized.includes('uk')) {
    return 'europe';
  }

  if (normalized.includes('uae') || normalized.includes('saudi') || normalized.includes('middle east') || normalized.includes('gulf')) {
    return 'middle_east';
  }

  if (normalized.includes('sea') || normalized.includes('southeast asia') || normalized.includes('singapore') || normalized.includes('malaysia') || normalized.includes('thailand')) {
    return 'southeast_asia';
  }

  return 'global';
}

export function inferBaselineCertifications(category: ProductCategory, region: TargetMarketRegion): string[] {
  const base: string[] = [];

  if (category === 'electronics_accessories') {
    base.push('CE', 'RoHS');
    if (region === 'north_america') {
      base.push('FCC');
    }
  }

  if (category === 'drinkware' || category === 'kitchenware') {
    if (region === 'north_america') {
      base.push('FDA');
    }
    if (region === 'europe') {
      base.push('LFGB');
    }
  }

  if (category === 'beauty_tools') {
    base.push('REACH');
  }

  return Array.from(new Set(base));
}

export function inferRecommendedPriceBand(category: ProductCategory): string {
  switch (category) {
    case 'drinkware':
      return 'USD 3.20 - 7.80 landed retail';
    case 'fitness':
      return 'USD 18 - 45 retail';
    case 'pet':
      return 'USD 15 - 38 retail';
    case 'home_storage':
      return 'USD 12 - 35 retail';
    case 'beauty_tools':
      return 'USD 12 - 28 retail';
    case 'electronics_accessories':
      return 'USD 18 - 49 retail';
    case 'home_textiles':
      return 'USD 20 - 60 retail';
    case 'kitchenware':
      return 'USD 15 - 42 retail';
    default:
      return 'Mid-market';
  }
}

export function inferBuyerProfile(category: ProductCategory): string {
  switch (category) {
    case 'drinkware':
      return 'Lifestyle and wellness buyers looking for daily-use products with clear brand identity.';
    case 'fitness':
      return 'Home workout and entry-level fitness buyers who compare durability, portability, and style.';
    case 'pet':
      return 'Pet owners who value safety, convenience, and easy cleaning over the absolute lowest price.';
    case 'home_storage':
      return 'Home-organization buyers seeking compact solutions, practical value, and visual consistency.';
    case 'beauty_tools':
      return 'Beauty-conscious shoppers who respond to premium texture, hygiene claims, and gifting appeal.';
    case 'electronics_accessories':
      return 'Value-driven gadget buyers who expect compatibility, safety certifications, and reliable charging performance.';
    case 'home_textiles':
      return 'Comfort-focused home buyers comparing material claims, softness, and packaging presentation.';
    case 'kitchenware':
      return 'Kitchen utility buyers who prioritize food safety, easy cleaning, and stackable storage.';
    default:
      return 'General e-commerce buyers comparing value, usability, and delivery confidence.';
  }
}

export function applyFollowUpToBrief(brief: ProcurementBrief, prompt: string): ProcurementBrief {
  const normalized = normalizeText(prompt);
  const nextBrief: ProcurementBrief = {
    ...brief,
    certifications: [...brief.certifications],
    materials: [...brief.materials],
    specs: [...brief.specs],
    referenceLinks: [...brief.referenceLinks],
    referenceImages: [...brief.referenceImages],
    notes: [...brief.notes, `Follow-up: ${prompt}`]
  };

  if (normalized.includes('moq') || normalized.includes('minimum order')) {
    nextBrief.moqTarget = Math.max(50, Math.floor((brief.moqTarget || 600) * 0.65));
  }

  if (normalized.includes('lead time') || normalized.includes('faster') || normalized.includes('faster shipping')) {
    nextBrief.preferredLeadTimeDays = Math.min(20, brief.preferredLeadTimeDays || 25);
  }

  if (normalized.includes('cheaper') || normalized.includes('budget') || normalized.includes('lower price')) {
    nextBrief.priorityMode = 'low_price';
  }

  if (normalized.includes('quality') || normalized.includes('premium')) {
    nextBrief.priorityMode = 'quality';
  }

  if (normalized.includes('balanced')) {
    nextBrief.priorityMode = 'balanced';
  }

  if (normalized.includes('assertive') || normalized.includes('stronger') || normalized.includes('firmer')) {
    nextBrief.inquiryTone = 'assertive';
  } else if (normalized.includes('concise') || normalized.includes('shorter')) {
    nextBrief.inquiryTone = 'concise';
  } else if (normalized.includes('professional') || normalized.includes('formal')) {
    nextBrief.inquiryTone = 'professional';
  }

  return nextBrief;
}

export function coerceInquiryTone(value: unknown): InquiryTone {
  if (value === 'concise' || value === 'assertive') {
    return value;
  }

  return 'professional';
}
