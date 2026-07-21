import type { CoachLoopDashboard } from '@traverse/api-client';

export type CoachRelationship = CoachLoopDashboard['relationships'][number];

/**
 * The relationship tracker is the source of truth for every non-archived
 * relationship. Invitations must remain visible while onboarding is pending.
 */
export function trackerRelationships(relationships: CoachRelationship[] | undefined) {
  return relationships ?? [];
}

/** Group membership begins only after the client has completed onboarding. */
export function groupEligibleRelationships(relationships: CoachRelationship[]) {
  return relationships.filter((relationship) => relationship.health !== 'invited');
}

export function defaultEligibleRelationshipId(relationships: CoachRelationship[]) {
  return groupEligibleRelationships(relationships)[0]?.id ?? '';
}

export function isGroupMembershipReady(input: {
  activeGroupCount: number;
  clientId: string;
  groupId: string;
}) {
  return input.activeGroupCount > 0 && input.groupId !== '' && input.clientId !== '';
}
