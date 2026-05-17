import { type NextRequest, NextResponse } from "next/server";
import { createProxyClient } from "@/lib/supabase/proxy-client";
import { ROUTES } from "@/lib/constants/routes";

export async function proxy(request: NextRequest) {
  const { supabase, response } = createProxyClient(request);
  const { pathname } = request.nextUrl;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (process.env.NODE_ENV === "development") {
    console.log(`[proxy] ${pathname} | user: ${user?.email ?? "none"}`);
  }

  // Unauthenticated user on a protected route → redirect to login
  if (!user && pathname !== ROUTES.LOGIN) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = ROUTES.LOGIN;

    if (process.env.NODE_ENV === "development") {
      console.log(`[proxy] Redirecting unauthenticated user to ${ROUTES.LOGIN}`);
    }

    return NextResponse.redirect(loginUrl);
  }

  // Authenticated user on login page → redirect to dashboard
  if (user && pathname === ROUTES.LOGIN) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = ROUTES.DASHBOARD;

    if (process.env.NODE_ENV === "development") {
      console.log(`[proxy] Redirecting authenticated user to ${ROUTES.DASHBOARD}`);
    }

    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

export const config = {
  // Excludes:
  //   _next/static, _next/image   — Next.js build assets
  //   favicon.ico, icon.png        — favicons
  //   logo/.*                      — brand assets in /public/logo
  //   auth/callback                — Supabase auth redirect
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|logo/|auth/callback).*)",
  ],
};
