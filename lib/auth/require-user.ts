import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/constants/routes";

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    const headersList = await headers();
    const pathname = headersList.get("x-next-pathname") ?? headersList.get("x-invoke-path") ?? "";
    const loginUrl = pathname && pathname !== ROUTES.LOGIN
      ? `${ROUTES.LOGIN}?next=${encodeURIComponent(pathname)}`
      : ROUTES.LOGIN;

    redirect(loginUrl);
  }

  return user;
}
