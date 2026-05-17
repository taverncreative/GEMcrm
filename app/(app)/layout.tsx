import { requireUser } from "@/lib/auth/require-user";
import { AppShell } from "@/components/app-shell";
import { MobileFab } from "@/components/layout/mobile-fab";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <AppShell userEmail={user.email ?? "Unknown user"}>
      {children}
      <MobileFab />
    </AppShell>
  );
}
