export const STARTER_AGREEMENT_NAME = 'Traverse Starter Coaching Agreement';

export interface StarterAgreementPolicies {
  cancellationNoticeHours: number;
  cancellationSummary: string;
  refundPolicy: 'flexible' | 'standard' | 'strict';
}

export function shouldProvisionStarterAgreement(input: {
  contractRequired: boolean;
  starterTemplateSelected: boolean;
}): boolean {
  return input.contractRequired && input.starterTemplateSelected;
}

export function starterAgreement(policies: StarterAgreementPolicies): string {
  return `COACHING AGREEMENT

This agreement describes a coaching relationship. Coaching is educational and developmental. It is not therapy, medical care, legal advice, or financial advice.

The coach and client will agree on goals, session timing, confidentiality boundaries, fees, and communication expectations before coaching begins.

Cancellation policy: ${policies.cancellationSummary || `${policies.cancellationNoticeHours} hours notice is requested.`}

Refund policy: ${policies.refundPolicy}.

This starter template is not legal advice. The coach is responsible for confirming that the final agreement is suitable for their services and jurisdiction.`;
}
