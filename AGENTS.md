# Project Rules

## Deployment
- This project is a TanStack Start / Nitro SSR app deployed on Vercel.
- Use the project root as the Vercel Root Directory.
- Use the Vercel Other framework preset if Vercel does not auto-detect TanStack Start correctly.
- Use `npm ci` for the Install Command and `npm run build` for the Build Command.
- The build must produce `.vercel/output`; do not deploy only `dist/` for this app.
- Keep `vercel.json` minimal unless a real routing or build issue requires more.
- If Vercel shows `404: NOT_FOUND`, first verify the Root Directory, install command, build command, package manager, and `.vercel/output` build output.

## Environment Safety
- Never commit `.env`, `.env.local`, or any file containing real secrets.
- Keep `.env.example` committed with variable names and placeholder values only.
- Keep `VERCEL_ENV_IMPORT.local.env` and `VERCEL_ENV_VALUES.local.md` local and ignored by Git.
- Public browser variables use `VITE_*` and are visible to users.
- Secret backend/server variables must never use `VITE_*`.

## Supabase
- `SUPABASE_URL` is the base project URL, for example `https://PROJECT_REF.supabase.co`; do not include `/rest/v1`.
- `SUPABASE_PUBLISHABLE_KEY` is the anon/public key used by server-side auth-aware clients.
- `VITE_SUPABASE_URL` is the same base project URL exposed to the browser.
- `VITE_SUPABASE_PUBLISHABLE_KEY` is the same anon/public key exposed to the browser.
- `VITE_SUPABASE_PROJECT_ID` is the project ref, the part before `.supabase.co`.
- `SUPABASE_SERVICE_ROLE_KEY` is secret and server-only. Never place it in frontend code, `VITE_*`, or public docs.
- Do not require the service role key unless backend admin code must bypass RLS. Public/user-authenticated reads and writes should use anon/public keys plus RLS policies.

## Database
- Migrations are SQL files that create or update Supabase tables and policies.
- Supabase migrations live in `supabase/migrations`.
- The Supabase project ref is the part of `https://PROJECT_REF.supabase.co` before `.supabase.co`.
- If Supabase reports that a table is missing from the schema cache, apply the SQL migrations to the target project.
- If a required table exists but has no rows, either add seed data through an idempotent migration or make the UI handle the empty state.

## AI Keys
- `GEMINI_API_KEY` is secret backend/server-only and must never use `VITE_*`.
- `GEMINI_MODEL` should default to `gemini-2.5-flash-lite` for student projects unless the user asks for another model.

## Before Deploy
- Confirm `git status` does not include real env files.
- Confirm `.env.example` has placeholders only.
- Confirm Vercel has all required environment variables for Production, Preview, and Development.
- Run `npm run build` and confirm `.vercel/output` exists.
- Confirm Supabase migrations have been applied to the Vercel target project.
