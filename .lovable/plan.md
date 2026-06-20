## Deploy `apify-actor-probe` Edge Function

### Goal
Deploy the `apify-actor-probe` edge function exactly as it exists in the repository (`supabase/functions/apify-actor-probe/index.ts`), with no code modifications.

### Steps
1. Verify the function file exists locally in `supabase/functions/apify-actor-probe/index.ts`.
2. Call `supabase--deploy_edge_functions` with `["apify-actor-probe"]`.
3. Confirm deployment succeeded.

No code changes, migrations, or frontend impact.