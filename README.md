# CareLedger

The admin command center for caring for an aging parent. CareLedger helps
adult children manage the non-medical paperwork of eldercare: tracking
facility bills, splitting expenses across family members, storing important
documents, and logging visits. **No medical data.**

This is the initial scaffold — auth, multi-tenant foundation, marketing
landing page, and four empty dashboard tabs. Feature work comes in later
steps.

## Stack

- **Next.js 14** (App Router) + **TypeScript**
- **Tailwind CSS** + **shadcn/ui** components
- **Supabase**: Postgres + email/password auth, Row Level Security for
  tenant isolation

## Project layout

```
app/
  page.tsx                 # marketing landing + waitlist
  login/, signup/          # auth pages
  app/                     # protected dashboard (Bills/Expenses/Documents/Visits)
  actions/                 # server actions (auth, waitlist)
components/
  ui/                      # shadcn/ui primitives
  waitlist-form.tsx, login-form.tsx, signup-form.tsx, dashboard-tabs.tsx
lib/
  supabase/                # client / server / middleware Supabase helpers
  utils.ts                 # cn()
supabase/
  migrations/0001_init.sql # accounts, users, waitlist + RLS + signup trigger
middleware.ts              # protects /app/*, refreshes session cookies
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

1. Go to <https://supabase.com>, create a new project, wait for it to provision.
2. **Project Settings → API** — copy the **Project URL** and **anon public** key.

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

### 4. Apply the database schema

Open **SQL Editor** in the Supabase dashboard, paste the contents of
`supabase/migrations/0001_init.sql`, and run it. This creates:

- `accounts` — one row per tenant workspace
- `users` — `auth.users` → `accounts` mapping (carries `account_id`)
- `waitlist` — public landing-page signups
- `current_account_id()` — RLS helper
- `handle_new_user()` trigger — provisions an account on signup
- RLS policies that scope every authenticated query to the user's account

> **Why a trigger?** It guarantees that every new auth user gets exactly one
> account, atomically, regardless of which client created them.

Alternatively, with the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase link --project-ref <project-ref>
supabase db push
```

### 5. Auth settings

In the Supabase dashboard:

- **Authentication → Providers → Email**: enable Email provider.
- **Authentication → URL Configuration**: set **Site URL** to
  `http://localhost:3000` for local dev.
- For first-run convenience you can disable "Confirm email" so signups go
  straight into the app. Re-enable before production.

### 6. Run the app

```bash
npm run dev
```

Open <http://localhost:3000>:

- `/` — landing page with waitlist signup
- `/signup` — create an account (auto-provisions a tenant)
- `/login` — sign in
- `/app` — protected dashboard with Bills / Expenses / Documents / Visits tabs

## Multi-tenant model

Every domain table in this app must include `account_id uuid references
accounts(id)` and an RLS policy:

```sql
create policy "<table>_tenant_isolation"
  on public.<table> for all
  to authenticated
  using (account_id = public.current_account_id())
  with check (account_id = public.current_account_id());
```

The four feature tables (bills, expenses, documents, visits) will follow this
pattern in later steps.

## Scripts

| Command          | What it does                |
| ---------------- | --------------------------- |
| `npm run dev`    | Start the Next.js dev server |
| `npm run build`  | Production build             |
| `npm run start`  | Run the production build     |
| `npm run lint`   | ESLint                       |
| `npm run typecheck` | Type-check without emitting |
