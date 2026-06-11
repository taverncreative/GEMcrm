import { requireUser } from "@/lib/auth/require-user";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

// PDF generation (service report / invoice / agreement) runs headless
// Chromium inside server actions — cold extract + launch + render can
// exceed the platform's default function timeout. Set at the layout so
// it covers every (app) page: the PDF actions execute under whichever
// page hosts the form, and outbox replays run them from any route the
// app happens to be on when sync drains.
export const maxDuration = 30;

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
    <AppShell
      userEmail={user.email ?? "Unknown user"}
      userId={user.id}
    >
      {children}
    </AppShell>
  );
}
