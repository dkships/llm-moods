# Security Policy

## Supported Versions

Only the current `main` branch is actively maintained.

## Reporting a Vulnerability

Please use [GitHub's private vulnerability reporting](https://github.com/dkships/llm-moods/security/advisories/new) to report security issues. Do not open a public issue for security vulnerabilities.

## Architecture Notes

- **Edge Functions** have `verify_jwt = false` because there is no user authentication. Each function that writes data or spends on paid APIs enforces its own gate (service-role bearer, trigger-secret header, or a scheduler token compared in constant time) in `supabase/functions/_shared/runtime.ts`; only `fetch-vendor-status` (fixed upstream URLs, cached) is open.
- **All API keys and secrets** are stored as Supabase Edge Function secrets (server-side only) and are never exposed to the frontend.
- **Frontend environment variables** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) are safe to expose — they provide read-only access via Supabase Row Level Security.
