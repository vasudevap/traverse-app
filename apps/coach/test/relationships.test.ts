import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoachRelationship } from '../src/relationships.js';
import {
  defaultEligibleRelationshipId,
  groupEligibleRelationships,
  isGroupMembershipReady,
  trackerRelationships,
} from '../src/relationships.js';
import { COACH_DASHBOARD_PATH, isCoachDashboardPath } from '../src/routes.js';

function relationship(overrides: Partial<CoachRelationship>): CoachRelationship {
  return {
    client: { email: 'client@example.test', id: 'client-1', name: 'Synthetic Client' },
    health: 'active',
    id: 'relationship-1',
    inviteExpiresAt: null,
    lastActivityAt: '2026-07-21T12:00:00.000Z',
    nextAppointment: null,
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
