/** The invitation confirmation and the authenticated Coach app share this route. */
export const COACH_DASHBOARD_PATH = '/dashboard';
export const COACH_PRACTICE_SETUP_PATH = '/settings/practice';

export function isCoachDashboardPath(pathname: string) {
  return pathname === COACH_DASHBOARD_PATH;
}
