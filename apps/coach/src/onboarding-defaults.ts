import type { CoachSetupSnapshot } from '@traverse/api-client';

export function onboardingDefaultsFormState(defaults: CoachSetupSnapshot['onboardingDefaults']) {
  return {
    defaults: { ...defaults },
    reminderCadenceText: defaults.reminderCadenceDays.join(', '),
  };
}
