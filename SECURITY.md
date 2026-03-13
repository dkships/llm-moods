# Security Policy

## Supported Versions

Only the current `main` branch is actively maintained.

## Reporting a Vulnerability

Please use [GitHub's private vulnerability reporting](https://github.com/dkships/llm-moods/security/advisories/new) to report security issues. Do not open a public issue for security vulnerabilities.

## Architecture Notes

- **Edge Functions** have `verify_jwt = false` by design — this is a public, read-only dashboard with no user authentication.
- **All API keys and secrets** are stored as Supabase Edge Function secrets (server-side only) and are never exposed to the frontend.
- **Frontend environment variables** (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) are safe to expose — they provide read-only access via Supabase Row Level Security.
