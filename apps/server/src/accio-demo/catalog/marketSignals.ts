import { ProductCategory, TargetMarketRegion } from '../types';

export interface MarketSignalRecord {
  category: ProductCategory;
  region: TargetMarketRegion;
  positioning: string;
  valueProps: string[];
  risks: string[];
}

export const MARKET_SIGNALS: MarketSignalRecord[] = [
  {
    category: 'drinkware',
    region: 'north_america',
    positioning: 'Premium daily hydration with gifting-friendly finishes and sustainable storytelling.',
    valueProps: ['powder-coated finish', 'BPA-free claim', 'bundled straw or lid variants'],
    risks: ['crowded category', 'high return sensitivity around leakage and paint finish']
  },
  {
    category: 'drinkware',
    region: 'europe',
    positioning: 'Functional, low-waste drinkware with clean silhouettes and food-contact confidence.',
    valueProps: ['LFGB-ready positioning', 'dishwasher guidance', 'muted color palette'],
    risks: ['compliance scrutiny for food-contact materials', 'shipping weight pressure']
  },
  {
    category: 'fitness',
    region: 'north_america',
    positioning: 'Portable workout gear for beginner and intermediate home users.',
    valueProps: ['compact storage', 'bundle-ready accessories', 'giftable packaging'],
    risks: ['performance claims can trigger complaints', 'materials must withstand repeated use']
  },
  {
    category: 'pet',
    region: 'north_america',
    positioning: 'Convenience-led pet accessories with safety-first messaging.',
    valueProps: ['easy-clean construction', 'odor-resistant materials', 'multi-pet household usability'],
    risks: ['safety failures damage trust quickly', 'durability complaints are public and sticky']
  },
  {
    category: 'home_storage',
    region: 'europe',
    positioning: 'Space-saving storage with modular organization value.',
    valueProps: ['stackable design', 'clean visual merchandising', 'multi-room use cases'],
    risks: ['bulky packaging costs', 'breakage risk on lower-grade plastics']
  },
  {
    category: 'beauty_tools',
    region: 'north_america',
    positioning: 'Routine-upgrade beauty accessories with premium tactile cues.',
    valueProps: ['gift set potential', 'hygiene claims', 'travel-friendly form factor'],
    risks: ['cheap-looking finishes hurt conversion', 'material claims need consistency']
  },
  {
    category: 'electronics_accessories',
    region: 'europe',
    positioning: 'Reliable, safe accessories for practical daily use rather than novelty.',
    valueProps: ['clear compatibility matrix', 'certification-forward messaging', 'organized retail packaging'],
    risks: ['certification gaps', 'power and safety claims require precise documentation']
  },
  {
    category: 'home_textiles',
    region: 'global',
    positioning: 'Comfort-led home products with texture and color assortment advantages.',
    valueProps: ['touch-and-feel storytelling', 'seasonal collections', 'bundle and upsell potential'],
    risks: ['material inconsistency', 'color drift across batches']
  },
  {
    category: 'kitchenware',
    region: 'north_america',
    positioning: 'Practical, easy-clean kitchen essentials with strong repeat-use value.',
    valueProps: ['food safety messaging', 'space efficiency', 'multi-use claims'],
    risks: ['food-contact compliance', 'surface durability complaints']
  }
];
