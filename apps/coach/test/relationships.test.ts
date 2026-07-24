import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoachRelationship } from '../src/relationships.js';
import {
  defaultEligibleRelationshipId,
  groupEligibleRelationships,
  isGroupMembershipReady,
  trackerRelationships,
} from '../src/relationships.js';
import {
  COACH_DASHBOARD_PATH,
  COACH_PRACTICE_SETUP_PATH,
  isCoachDashboardPath,
} from '../src/routes.js';
import { onboardingDefaultsFormState } from '../src/onboarding-defaults.js';
import { policyDefaultsFormState } from '../src/policy-defaults.js';

function relationship(overrides: Partial<CoachRelationship>): CoachRelationship {
  return {
    client: { email: 'client@example.test', id: 'client-1', name: 'Synthetic Client' },
    contractId: null,
    health: 'active',
    id: 'relationship-1',
    inviteExpiresAt: null,
    lastActivityAt: '2026-07-21T12:00:00.000Z',
    nextAppointment: null,
    onboardingState: null,
    openTaskCount: 0,
    ...overrides,
  };
}

test('TRA-92 and TRA-97 retain pending relationships in the tracker but not group membership', () => {
  const invited = relationship({
    health: 'invited',
    id: 'relationship-invited',
    inviteExpiresAt: '2026-08-04T12:00:00.000Z',
  });
  const onboarding = relationship({ health: 'onboarding', id: 'relationship-onboarding' });
  const active = relationship({ id: 'relationship-active' });

  assert.deepEqual(trackerRelationships([invited, onboarding, active]), [
    invited,
    onboarding,
    active,
  ]);
  assert.deepEqual(groupEligibleRelationships([invited, onboarding, active]), [active]);
  assert.equal(defaultEligibleRelationshipId([invited, onboarding, active]), active.id);
});

test('TRA-91 keeps Add to group disabled until a group and active client are selected', () => {
  assert.equal(
    isGroupMembershipReady({ activeGroupCount: 1, clientId: '', groupId: 'group-1' }),
    false,
  );
  assert.equal(
    isGroupMembershipReady({ activeGroupCount: 1, clientId: 'client-1', groupId: '' }),
    false,
  );
  assert.equal(
    isGroupMembershipReady({ activeGroupCount: 0, clientId: 'client-1', groupId: 'group-1' }),
    false,
  );
  assert.equal(
    isGroupMembershipReady({ activeGroupCount: 1, clientId: 'client-1', groupId: 'group-1' }),
    true,
  );
});

test('TRA-92 invitation confirmation returns to the routed Coach dashboard', () => {
  assert.equal(COACH_DASHBOARD_PATH, '/dashboard');
  assert.equal(isCoachDashboardPath(COACH_DASHBOARD_PATH), true);
  assert.equal(isCoachDashboardPath('/'), false);
});

test('dashboard users have a dedicated route back to practice setup', () => {
  assert.equal(COACH_PRACTICE_SETUP_PATH, '/settings/practice');
});

test('onboarding defaults form state reflects a successful Traverse-defaults reset', () => {
  const state = onboardingDefaultsFormState({
    contractRequired: true,
    countersignatureRequired: false,
    intakeRequired: true,
    inviteExpiryDays: 14,
    paymentRequired: false,
    reminderCadenceDays: [3, 7],
  });

  assert.equal(state.reminderCadenceText, '3, 7');
  assert.equal(state.defaults.inviteExpiryDays, 14);
  assert.equal(state.defaults.contractRequired, true);
});

test('policy defaults form state reflects a successful starter-defaults reset', () => {
  const state = policyDefaultsFormState({
    cancellationNoticeHours: 24,
    cancellationSummary: 'Please give at least 24 hours notice when you need to reschedule.',
    refundPolicy: 'standard',
    starterTemplateSelected: true,
    welcomeMessage: 'Glad you are here. I am looking forward to working together.',
  });

  assert.equal(state.cancellationNoticeHours, 24);
  assert.equal(state.refundPolicy, 'standard');
  assert.equal(state.starterTemplateSelected, true);
});
