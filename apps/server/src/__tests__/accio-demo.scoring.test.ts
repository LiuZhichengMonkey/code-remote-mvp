import { scoreSupplier } from '../accio-demo/scoring/supplierScoring';
import { SUPPLIER_CATALOG } from '../accio-demo/catalog/suppliers';
import { NormalizedRequirements } from '../accio-demo/types';

describe('accio demo supplier scoring', () => {
  const baseRequirements: NormalizedRequirements = {
    category: 'drinkware',
    region: 'north_america',
    sourcingSummary: 'Source insulated water bottle for US launch.',
    targetPriceBand: 'Target factory cost near USD 3.20',
    moqTarget: 500,
    preferredLeadTimeDays: 25,
    requiredCertifications: ['FDA'],
    desiredMaterials: ['stainless steel'],
    mustHaveSpecs: ['insulated wall'],
    openQuestions: [],
    priorityMode: 'balanced',
    inquiryTone: 'professional'
  };

  test('scores close-fitting drinkware supplier above weaker category match', () => {
    const strongSupplier = SUPPLIER_CATALOG.find(supplier => supplier.supplierId === 'sup_drink_001');
    const weakSupplier = SUPPLIER_CATALOG.find(supplier => supplier.supplierId === 'sup_elec_001');

    expect(strongSupplier).toBeTruthy();
    expect(weakSupplier).toBeTruthy();

    const strongScore = scoreSupplier(strongSupplier!, baseRequirements);
    const weakScore = scoreSupplier(weakSupplier!, baseRequirements);

    expect(strongScore.total).toBeGreaterThan(weakScore.total);
    expect(strongScore.breakdown.category).toBe(100);
  });

  test('changes scoring profile when quality mode is selected', () => {
    const premiumSupplier = SUPPLIER_CATALOG.find(supplier => supplier.supplierId === 'sup_drink_002');

    expect(premiumSupplier).toBeTruthy();

    const balanced = scoreSupplier(premiumSupplier!, baseRequirements).total;
    const quality = scoreSupplier(premiumSupplier!, {
      ...baseRequirements,
      priorityMode: 'quality'
    }).total;

    expect(quality).not.toBe(balanced);
    expect(quality).toBeGreaterThanOrEqual(0);
    expect(quality).toBeLessThanOrEqual(100);
  });
});
