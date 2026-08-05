/** The invitation confirmation and the authenticated Coach app share this route. */
export const COACH_DASHBOARD_PATH = '/dashboard';
export const COACH_PRACTICE_SETUP_PATH = '/settings/practice';

const navigationItems = [
  { href: COACH_DASHBOARD_PATH, label: 'Dashboard' },
  { href: '/clients', label: 'Clients' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/groups', label: 'Groups' },
  { href: '/settings/data', label: 'Data' },
  { href: '/logout', label: 'Sign out' },
];

export function isCoachDashboardPath(pathname: string) {
  return pathname === COACH_DASHBOARD_PATH;
}

export function isCoachNavigationItemCurrent(href: string, pathname: string) {
  if (href === '/logout') return false;
  return href === COACH_DASHBOARD_PATH ? isCoachDashboardPath(pathname) : pathname === href;
}

export function coachNavigation(pathname: string) {
  return navigationItems.map((item) => ({
    ...item,
    current: isCoachNavigationItemCurrent(item.href, pathname),
  }));
}
