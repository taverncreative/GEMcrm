export const ROUTES = {
  LOGIN: "/login",
  DASHBOARD: "/dashboard",
  CUSTOMERS: "/customers",
  CUSTOMERS_NEW: "/customers/new",
  SITES: "/sites",
  JOBS: "/jobs",
  AGREEMENTS: "/agreements",
  CALENDAR: "/calendar",
  REPORTS: "/reports",
  SETTINGS: "/settings",
  AUTH_CALLBACK: "/auth/callback",

  customerDetail: (id: string) => `/customers/${id}` as const,
  siteDetail: (id: string) => `/sites/${id}` as const,
  jobDetail: (id: string) => `/jobs/${id}` as const,
} as const;
