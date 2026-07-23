import type { CoachSetupSnapshot } from '@traverse/api-client';

export function policyDefaultsFormState(policies: CoachSetupSnapshot['policies']) {
  return { ...policies };
}
