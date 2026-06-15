#!/usr/bin/env bash
#
# Rebuild the LOCAL Supabase dev database from scratch.
#
# Replaces `supabase db reset` for this project: migrations 001-037 are NOT
# self-contained — 001 does `alter table jobs ...` but no migration creates
# the base tables (they live only in setup.sql), so a reset replay fails at
# 001. Instead this loads the canonical schema + a clean seed + a local
# login user:
#
#   setup.sql  ->  bucket-only.sql  ->  staging-seed.sql  ->  dev auth user
#
# Idempotent: re-running wipes public data and reseeds, so it always lands
# the current seed (incl. renames). Requires the local stack to be running
# (`supabase start`). LOCAL ONLY — never aim this at a remote/prod project.

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="$(grep -E '^project_id' supabase/config.toml | sed -E 's/.*"(.*)".*/\1/')"
DB_CONTAINER="supabase_db_${PROJECT_ID}"
DEV_EMAIL="dev@gemcrm.local"
DEV_PASSWORD="localdev123"

# API URL + service-role key from the running local stack.
eval "$(supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"

if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  echo "ERROR: ${DB_CONTAINER} is not running. Start it with: supabase start" >&2
  exit 1
fi

# Refuse to run unless the API points at localhost — guard against a
# misconfigured stack ever aiming this at a remote project.
case "${API_URL:-}" in
  http://127.0.0.1:*|http://localhost:*) : ;;
  *) echo "ERROR: API_URL is '${API_URL:-unset}', not local. Aborting." >&2; exit 1 ;;
esac

psql_local() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

echo "==> Schema (setup.sql)"
psql_local < supabase/setup.sql > /dev/null

echo "==> Storage bucket (bucket-only.sql)"
psql_local < supabase/bucket-only.sql > /dev/null

echo "==> Clean public data (truncate all public tables)"
psql_local <<'SQL' > /dev/null
do $$ declare r record; begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('truncate table public.%I restart identity cascade', r.tablename);
  end loop;
end $$;
SQL

echo "==> Seed (staging-seed.sql)"
psql_local < supabase/seeds/staging-seed.sql > /dev/null

echo "==> Local auth user (${DEV_EMAIL})"
RESP="$(curl -s -X POST "${API_URL}/auth/v1/admin/users" \
  -H "apikey: ${SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${DEV_EMAIL}\",\"password\":\"${DEV_PASSWORD}\",\"email_confirm\":true}")"
if echo "$RESP" | grep -q '"id"'; then
  echo "    created"
elif echo "$RESP" | grep -qiE 'already|registered|exists'; then
  echo "    already exists (ok)"
else
  echo "    WARNING: unexpected response: $RESP"
fi

echo ""
echo "Local DB rebuilt. Log in at http://localhost:3001"
echo "   email:    ${DEV_EMAIL}"
echo "   password: ${DEV_PASSWORD}"
