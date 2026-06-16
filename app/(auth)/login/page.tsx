"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BUSINESS } from "@/lib/constants/branding";
import { ROUTES } from "@/lib/constants/routes";

type Mode = "signin" | "reset";

const inputClass =
  "mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Surface the callback's auth-failure redirect (?error=auth) — e.g. an
  // expired or already-used sign-in / recovery link. Read once on mount: a
  // lazy useState initializer would hydration-mismatch on this prerendered
  // page (window is absent at prerender), so this one-shot effect-set is the
  // correct pattern, not the cascading-render case the rule targets.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "auth") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError("That link was invalid or has expired — please try again.");
    }
  }, []);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setResetSent(false);
  }

  async function handleSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push(ROUTES.DASHBOARD);
    router.refresh();
  }

  async function handleSendReset(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    // The recovery link comes back through the existing /auth/callback code
    // exchange, which then forwards to the reset-password page (where the
    // user is signed into a short-lived recovery session to set a new one).
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: `${window.location.origin}${ROUTES.AUTH_CALLBACK}?next=${ROUTES.RESET_PASSWORD}`,
      }
    );

    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    // Neutral confirmation — never reveal whether the email is registered.
    setResetSent(true);
  }

  return (
    <div className="rounded-xl bg-white p-8 shadow-sm">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">
          {mode === "signin" ? "Sign in" : "Reset password"}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {mode === "signin"
            ? `Sign in to your ${BUSINESS.name} CRM account`
            : "We'll email you a link to set a new password."}
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {mode === "signin" ? (
        <form onSubmit={handleSignIn} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={inputClass}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700"
              >
                Password
              </label>
              <button
                type="button"
                onClick={() => switchMode("reset")}
                className="text-xs font-medium text-brand-darker hover:underline"
              >
                Forgot your password?
              </button>
            </div>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className={inputClass}
              placeholder="Enter your password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      ) : resetSent ? (
        <div className="space-y-4">
          <div className="rounded-lg bg-brand-soft p-4 text-sm text-brand-darker">
            If an account exists for <span className="font-medium">{email}</span>
            , we&rsquo;ve sent a link to reset your password. Check your inbox.
          </div>
          <button
            type="button"
            onClick={() => switchMode("signin")}
            className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Back to sign in
          </button>
        </div>
      ) : (
        <form onSubmit={handleSendReset} className="space-y-4">
          <div>
            <label
              htmlFor="reset-email"
              className="block text-sm font-medium text-gray-700"
            >
              Email
            </label>
            <input
              id="reset-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={inputClass}
              placeholder="you@example.com"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:opacity-50"
          >
            {loading ? "Sending..." : "Send reset link"}
          </button>
          <button
            type="button"
            onClick={() => switchMode("signin")}
            className="w-full rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
          >
            Back to sign in
          </button>
        </form>
      )}
    </div>
  );
}
