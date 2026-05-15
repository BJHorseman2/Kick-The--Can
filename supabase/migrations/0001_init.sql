-- CareLedger: initial schema
-- Multi-tenant foundation: every domain table carries account_id.
-- RLS isolates rows by the calling user's account.

set search_path = public;

-- =========================================================================
-- accounts: one tenant workspace
-- =========================================================================
create table if not exists public.accounts (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  created_at  timestamptz not null default now()
);

-- =========================================================================
-- users: maps auth.users (1:1 today) to an account
-- =========================================================================
create table if not exists public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now()
);

create index if not exists users_account_id_idx on public.users (account_id);

-- =========================================================================
-- waitlist: public landing-page signups (pre-auth)
-- =========================================================================
create table if not exists public.waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  created_at  timestamptz not null default now()
);

-- =========================================================================
-- Helper: account_id of the calling user. Used in RLS policies.
-- security definer so the function can read users without recursing
-- through users' own RLS.
-- =========================================================================
create or replace function public.current_account_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select account_id from public.users where id = auth.uid();
$$;

revoke all on function public.current_account_id() from public;
grant execute on function public.current_account_id() to authenticated;

-- =========================================================================
-- Trigger: on auth.users insert, provision an account and link the user.
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_account_id uuid;
begin
  insert into public.accounts (name)
  values (coalesce(new.raw_user_meta_data ->> 'account_name', new.email))
  returning id into new_account_id;

  insert into public.users (id, account_id, email)
  values (new.id, new_account_id, new.email);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- Row Level Security
-- =========================================================================
alter table public.accounts enable row level security;
alter table public.users    enable row level security;
alter table public.waitlist enable row level security;

-- accounts: members of an account can read/update it
drop policy if exists "accounts_select_own" on public.accounts;
create policy "accounts_select_own"
  on public.accounts for select
  to authenticated
  using (id = public.current_account_id());

drop policy if exists "accounts_update_own" on public.accounts;
create policy "accounts_update_own"
  on public.accounts for update
  to authenticated
  using (id = public.current_account_id())
  with check (id = public.current_account_id());

-- users: see fellow members of own account
drop policy if exists "users_select_own_account" on public.users;
create policy "users_select_own_account"
  on public.users for select
  to authenticated
  using (account_id = public.current_account_id());

-- waitlist: anyone (anon or authed) can sign up; nobody can read from the
-- client. Reads require service role (e.g. admin tools or exports).
drop policy if exists "waitlist_insert_any" on public.waitlist;
create policy "waitlist_insert_any"
  on public.waitlist for insert
  to anon, authenticated
  with check (true);
