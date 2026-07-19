# Status manifest schema (version 1)

Machine-readable project status for the project tracker. A conforming manifest
is a single JSON object matching the shape below.

## Schema

```
{
  "schema_version": 1,
  "project": {
    "id": "slug",              // stable, lowercase
    "name": "Display Name",
    "one_liner": "what it is in one sentence",
    "mission": "what the app is trying to be, 2-3 sentences",
    "stack": ["Next.js", "Supabase"],
    "status": "live" | "building" | "parked",
    "repo": "org/name"
  },
  "slices": [
    { "id": "slug", "title": "...", "state": "shipped" | "in_progress" | "planned" | "parked", "shipped_at": "YYYY-MM-DD or null", "note": "optional" }
  ],
  "ideas": ["uncommitted potential features, plain strings"],
  "blockers": [
    { "on": "john" | "external" | "none", "note": "..." }
  ],
  "report": { "generated_at": "ISO datetime", "type": "onboarding" | "situation", "summary": "3-5 sentence current state" }
}
```

## Validation rules

- slugs are lowercase letters/digits/hyphens
- shipped_at is YYYY-MM-DD or null
- generated_at is a real ISO datetime
- enum fields accept only the exact values listed

## Content rules

- `report.type` = `"onboarding"` for an onboarding manifest; `"situation"` for a later status update.
- slices = real shipped work and genuinely planned next steps, not padding.
- ideas = uncommitted possibilities only.
- blockers = anything waiting on the owner (pushes, verifies, external accounts/reviews) or external parties; use `"none"` only if truly clear.
- Nothing is `"shipped"` unless it is verified in production / on `main`.
