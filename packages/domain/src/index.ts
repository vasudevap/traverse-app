/** DTOs, Zod schemas, and event envelopes land here (Stage 2+). */
export const ROLES = ['admin', 'coach', 'billingAdmin', 'client'] as const;
export type Role = (typeof ROLES)[number];
