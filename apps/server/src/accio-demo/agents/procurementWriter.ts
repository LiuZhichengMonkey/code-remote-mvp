import { InquiryDraft, NormalizedRequirements, SupplierMatch } from '../types';

function joinSupplierNames(matches: SupplierMatch[]): string {
  return matches.slice(0, 2).map(match => match.supplierName).join(' and ');
}

export class ProcurementWriterAgent {
  run(requirements: NormalizedRequirements, matches: SupplierMatch[]): InquiryDraft {
    const topSuppliers = joinSupplierNames(matches) || 'your team';
    const requiredCertifications = requirements.requiredCertifications.length > 0
      ? requirements.requiredCertifications.join(', ')
      : 'any available compliance documents';
    const mustHaveSpecs = requirements.mustHaveSpecs.length > 0
      ? requirements.mustHaveSpecs.join(', ')
      : 'the core product specifications from your standard line';

    return {
      professional: [
        'Hello,',
        '',
        `We are evaluating suppliers for a ${requirements.sourcingSummary.toLowerCase()}.`,
        `Please confirm your best quotation, sample timing, and production lead time for an MOQ around ${requirements.moqTarget} units.`,
        `We need confirmation on ${mustHaveSpecs}, along with documentation for ${requiredCertifications}.`,
        `If available, please also share packaging options, branding customization details, and your recommended sample process.`,
        '',
        `We are currently shortlisting suppliers including ${topSuppliers}, and we would appreciate a concise but complete response.`,
        '',
        'Best regards'
      ].join('\n'),
      concise: `Please quote ${requirements.moqTarget} units, confirm lead time, sample availability, customization options, and compliance documents for ${requiredCertifications}.`,
      assertive: `Please provide your best factory quote, latest compliance files, sample timing, and confirmed lead time for ${requirements.moqTarget} units. We will finalize our shortlist based on documentation quality, MOQ flexibility, and delivery reliability this week.`,
      checklist: [
        'Ask for factory quote and packaging breakdown.',
        'Request sample lead time and mass-production lead time.',
        'Request the latest compliance reports and audit files.',
        'Confirm customization options and logo setup charges.'
      ]
    };
  }
}
