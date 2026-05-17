function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[GemCRM] Missing required environment variable: ${name}. ` +
        `Check your .env.local file.`
    );
  }
  return value;
}

export const env = {
  get supabaseUrl() {
    return requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  },
} as const;
