/** Non-secret shared constants (secrets live in AWS Secrets Manager - P3-D section 7). */
export const PLAN_CODES = ['starter', 'practice', 'established'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

/**
 * Customer-facing names for the stable plan identifiers. Use codes for persistence,
 * pricing configuration, and Stripe price mappings; use these names in display-only
 * surfaces.
 */
export const PLAN_DISPLAY_NAMES: Record<PlanCode, string> = {
  starter: 'Basic',
  practice: 'Pro',
  established: 'Premium',
};

/**
 * Video message limits per Decision V15. These are **configuration, not constants**:
 * the values below are defaults, overridable via environment and validated at load.
 * Feature code MUST read them through {@link loadVideoConfig}, never hard-code the
 * numbers - so the beta can retune caps/undo without a code change (V15).
 */
export const VIDEO_DEFAULTS = {
  maxSecondsCoach: 180,
  maxSecondsClient: 90,
  undoWindowSeconds: 10,
} as const;

export interface VideoConfig {
  maxSecondsCoach: number;
  maxSecondsClient: number;
  undoWindowSeconds: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid ${label}: expected a positive integer, got "${raw}"`);
  }
  return n;
}

/**
 * Resolve the V15 video limits from env (with validated defaults). Throws on an
 * invalid value or an incoherent combination, so misconfiguration fails fast at boot
 * rather than silently shipping a wrong cap.
 */
export function loadVideoConfig(env: NodeJS.ProcessEnv = process.env): VideoConfig {
  const cfg: VideoConfig = {
    maxSecondsCoach: parsePositiveInt(
      env.TRAVERSE_VIDEO_MAX_SECONDS_COACH,
      VIDEO_DEFAULTS.maxSecondsCoach,
      'TRAVERSE_VIDEO_MAX_SECONDS_COACH',
    ),
    maxSecondsClient: parsePositiveInt(
      env.TRAVERSE_VIDEO_MAX_SECONDS_CLIENT,
      VIDEO_DEFAULTS.maxSecondsClient,
      'TRAVERSE_VIDEO_MAX_SECONDS_CLIENT',
    ),
    undoWindowSeconds: parsePositiveInt(
      env.TRAVERSE_VIDEO_UNDO_WINDOW_SECONDS,
      VIDEO_DEFAULTS.undoWindowSeconds,
      'TRAVERSE_VIDEO_UNDO_WINDOW_SECONDS',
    ),
  };
  if (cfg.maxSecondsClient > cfg.maxSecondsCoach) {
    throw new Error('Video config invalid: client cap cannot exceed coach cap (V15).');
  }
  return cfg;
}

/**
 * Retention per amended Decision V6. The floor is a hard system rule (a coach cannot
 * configure below it); the default is the send-time retention when a coach sets none.
 * Coach-selectable retention within the tier range is persisted practice config,
 * introduced when the video feature is built - not here.
 */
export const RETENTION_FLOOR_DAYS = 14;
export const RETENTION_DEFAULT_DAYS = 30;
