import { ComplianceNote, NormalizedRequirements } from '../types';

const REGION_NOTES: Record<string, string[]> = {
  north_america: [
    'Confirm labeling, packaging, and importer-of-record requirements before PO approval.',
    'Ask for the latest test reports and production batch traceability.'
  ],
  europe: [
    'Align product claims and documentation with EU market surveillance expectations.',
    'Check packaging language and recycling mark obligations by destination country.'
  ],
  middle_east: [
    'Validate local registration or destination-specific conformity requirements early.',
    'Confirm packaging copy and any local language needs with the importer.'
  ],
  southeast_asia: [
    'Review destination-specific import documentation and product labeling requirements.',
    'Confirm whether local distributor registration is needed for the category.'
  ],
  global: [
    'Validate the target country requirements before sample approval.',
    'Keep supplier documentation organized for repeat import checks.'
  ]
};

export class ComplianceReviewerAgent {
  run(requirements: NormalizedRequirements): ComplianceNote {
    return {
      requiredCertifications: requirements.requiredCertifications,
      warnings: [
        `Do not approve bulk production until sample performance is validated for the ${requirements.category.replace(/_/g, ' ')} category.`,
        'Confirm whether the supplier can keep documentation current across reorders.'
      ],
      recommendedChecks: [
        'Request the latest compliance reports and factory audit evidence.',
        'Verify carton dimensions, packaging durability, and sample sign-off criteria.',
        'Confirm payment terms and defect handling before deposit release.'
      ],
      importNotes: REGION_NOTES[requirements.region]
    };
  }
}
