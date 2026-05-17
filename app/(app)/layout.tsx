import { requireUser } from "@/lib/auth/require-user";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  // Note: the mobile floating-action button used to live here but it
  // duplicated the header "+" sheet menu in QuickActions. Removed to
  // keep a single primary-action entry point on mobile.
  return (
    <AppShell userEmail={user.email ?? "Unknown user"}>
      {children}
    </AppShell>
  );
}
