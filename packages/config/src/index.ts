/** Non-secret shared constants (secrets live in AWS Secrets Manager - P3-D section 7). */
export const PLAN_CODES = ['starter', 'practice', 'established'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

/** Video rules per Decision V15 - configuration, not constants in spirit; env-overridable later. */
export const VIDEO_MAX_SECONDS_COACH = 180;
export const VIDEO_MAX_SECONDS_CLIENT = 90;
export const VIDEO_UNDO_WINDOW_SECONDS = 10;

/** Retention per amended Decision V6. */
export const RETENTION_FLOOR_DAYS = 14;
export const RETENTION_DEFAULT_DAYS = 30;
