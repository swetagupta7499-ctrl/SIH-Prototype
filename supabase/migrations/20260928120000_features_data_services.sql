-- ===========================================================================
-- TribalScholar — data & services for the new features
--   payments          PFMS / DBT pipeline per approved application
--   grievances        grievance tickets with activity history
--   chat_messages     multilingual AI assistant conversations
--   integration_logs  audit trail of DigiLocker / PFMS / AI calls
--   application_documents  + OCR quality / DigiLocker source columns
--
-- Row-level security: students see only their own rows; officers
-- (profiles.role = 'officer') see and manage everything.
-- Safe to re-run: every statement is idempotent.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Helper: is the current user an officer?
-- SECURITY DEFINER so policies can read profiles without recursive RLS.
-- ---------------------------------------------------------------------------
create or replace function public.is_officer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'officer'
  );
$$;

revoke all on function public.is_officer() from public;
grant execute on function public.is_officer() to authenticated;

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id             text primary key,
  application_id text not null,
  user_id        uuid not null references auth.users (id) on delete cascade,
  email          text,
  stage          smallint not null default 0 check (stage between 0 and 3),
  amount         numeric(12, 2) not null check (amount >= 0),
  data           jsonb not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists payments_user_id_idx on public.payments (user_id);
create index if not exists payments_application_id_idx on public.payments (application_id);

alter table public.payments enable row level security;
grant select, insert, update on public.payments to authenticated;

drop policy if exists "payments_select_own_or_officer" on public.payments;
create policy "payments_select_own_or_officer" on public.payments
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_officer()));

drop policy if exists "payments_insert_officer" on public.payments;
create policy "payments_insert_officer" on public.payments
  for insert to authenticated
  with check ((select public.is_officer()));

drop policy if exists "payments_update_officer" on public.payments;
create policy "payments_update_officer" on public.payments
  for update to authenticated
  using ((select public.is_officer()))
  with check ((select public.is_officer()));

-- ---------------------------------------------------------------------------
-- grievances
-- ---------------------------------------------------------------------------
create table if not exists public.grievances (
  ticket_id   text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  email       text,
  status      text not null check (status in ('Assigned', 'In Progress', 'Resolved')),
  department  text not null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists grievances_user_id_idx on public.grievances (user_id);
create index if not exists grievances_status_idx on public.grievances (status);

alter table public.grievances enable row level security;
grant select, insert, update on public.grievances to authenticated;

drop policy if exists "grievances_select_own_or_officer" on public.grievances;
create policy "grievances_select_own_or_officer" on public.grievances
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_officer()));

drop policy if exists "grievances_insert_own" on public.grievances;
create policy "grievances_insert_own" on public.grievances
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Students may update their own tickets (reopen); officers may update any.
drop policy if exists "grievances_update_own_or_officer" on public.grievances;
create policy "grievances_update_own_or_officer" on public.grievances
  for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_officer()))
  with check (user_id = (select auth.uid()) or (select public.is_officer()));

-- ---------------------------------------------------------------------------
-- chat_messages (AI assistant history; personal numbers are redacted
-- in the browser before they are sent or stored)
-- ---------------------------------------------------------------------------
create table if not exists public.chat_messages (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id  text not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null check (char_length(content) <= 4000),
  lang        text,
  source      text check (source in ('ai', 'kb')),
  created_at  timestamptz not null default now()
);

create index if not exists chat_messages_user_session_idx on public.chat_messages (user_id, session_id, created_at);

alter table public.chat_messages enable row level security;
grant select, insert on public.chat_messages to authenticated;
grant usage on sequence public.chat_messages_id_seq to authenticated;

drop policy if exists "chat_select_own_or_officer" on public.chat_messages;
create policy "chat_select_own_or_officer" on public.chat_messages
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_officer()));

drop policy if exists "chat_insert_own" on public.chat_messages;
create policy "chat_insert_own" on public.chat_messages
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- integration_logs (DigiLocker / PFMS / AI audit trail)
-- Browser inserts its own events; the gov-gateway Edge Function writes
-- with the service role. Only officers can read the log.
-- ---------------------------------------------------------------------------
create table if not exists public.integration_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid default auth.uid() references auth.users (id) on delete set null,
  service     text not null check (service in ('digilocker', 'pfms', 'ai')),
  action      text not null,
  mode        text not null check (mode in ('live', 'sandbox')),
  status      text not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists integration_logs_service_idx on public.integration_logs (service, created_at desc);

alter table public.integration_logs enable row level security;
grant select, insert on public.integration_logs to authenticated;
grant usage on sequence public.integration_logs_id_seq to authenticated;

drop policy if exists "integration_logs_insert_own" on public.integration_logs;
create policy "integration_logs_insert_own" on public.integration_logs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "integration_logs_select_officer" on public.integration_logs;
create policy "integration_logs_select_officer" on public.integration_logs
  for select to authenticated
  using ((select public.is_officer()));

-- ---------------------------------------------------------------------------
-- application_documents: record where each document came from and how
-- readable it was (only if the table already exists in this project).
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.application_documents') is not null then
    alter table public.application_documents
      add column if not exists source         text default 'upload',
      add column if not exists issuer         text,
      add column if not exists ocr_confidence smallint,
      add column if not exists image_quality  jsonb;
  end if;
end
$$;
