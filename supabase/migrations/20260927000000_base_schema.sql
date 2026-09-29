-- ===========================================================================
-- TribalScholar — base schema (previously created by hand, never migrated)
--   profiles               one row per auth user (full_name, role)
--   applications           scholarship applications (+ TS###### public id)
--   application_documents  documents attached to an application
--   storage bucket         application-documents (private)
--
-- Must sort BEFORE 20260928120000_features_data_services.sql, which:
--   * re-creates public.is_officer() (identical body below)
--   * adds source / issuer / ocr_confidence / image_quality to
--     application_documents (NOT added here on purpose)
--
-- Row-level security: students see/manage only their own rows; officers
-- (profiles.role = 'officer') see everything and manage applications.
-- Officers are promoted manually, e.g. in the SQL editor:
--   update public.profiles set role = 'officer' where email = '...';
-- Safe to re-run: every statement is idempotent.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Shared helper: keep updated_at current on every UPDATE
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'student' check (role in ('student', 'officer')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Helper: is the current user an officer?
-- SECURITY DEFINER so policies can read profiles without recursive RLS.
-- Body is IDENTICAL to the one in 20260928120000_features_data_services.sql.
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
-- Create a profile automatically for every new auth user.
-- signUp() passes options.data.full_name -> raw_user_meta_data.full_name.
-- The client never inserts into profiles itself (it only selects).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    'student'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill (no-op on a fresh project; harmless otherwise)
insert into public.profiles (id, email, full_name)
select u.id, u.email,
       coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1))
from auth.users u
on conflict (id) do nothing;

-- Users may never change their own role. Only officers, or privileged
-- contexts without a JWT user (SQL editor / service role), may change it.
create or replace function public.profiles_protect_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_officer() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.role := 'student';
  elsif new.role is distinct from old.role then
    raise exception 'Only an officer can change a profile role'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise exception 'Profile id cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role
  before insert or update on public.profiles
  for each row execute function public.profiles_protect_role();

alter table public.profiles enable row level security;

-- Column-level grants: authenticated users can only ever write these columns.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (id, email, full_name) on public.profiles to authenticated;
grant update (email, full_name) on public.profiles to authenticated;

drop policy if exists "profiles_select_own_or_officer" on public.profiles;
create policy "profiles_select_own_or_officer" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_officer()));

-- Fallback path only (trigger normally creates the row); role is forced to
-- 'student' by the trigger and is not insertable via column grants anyway.
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- applications
-- application_id ("TS260001", ...) is generated by the DATABASE: the client
-- insert does not send it, but reads application.application_id afterwards.
-- ---------------------------------------------------------------------------
create sequence if not exists public.applications_application_id_seq
  start with 260001;

grant usage on sequence public.applications_application_id_seq to authenticated;

create table if not exists public.applications (
  id              uuid primary key default gen_random_uuid(),
  application_id  text not null unique
                  default ('TS' || nextval('public.applications_application_id_seq')::text),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name            text not null,
  email           text,
  phone           text,
  scheme          text not null,
  education       text,
  income          numeric(14, 2),
  marks           numeric(6, 2),
  institution     text,
  status          text not null default 'Submitted'
                  check (status in ('Submitted', 'Under Review', 'Deficient', 'Approved (Demo)')),
  pre_check       boolean not null default false,
  issues          jsonb not null default '[]'::jsonb,
  review_note     text,
  rule_version    text,
  submitted_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter sequence public.applications_application_id_seq
  owned by public.applications.application_id;

create index if not exists applications_user_id_idx on public.applications (user_id);
create index if not exists applications_status_idx on public.applications (status);
create index if not exists applications_submitted_at_idx on public.applications (submitted_at desc);

drop trigger if exists applications_set_updated_at on public.applications;
create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

-- Students may create their application and update it (the Ticket Hub
-- re-upload moves Deficient -> Under Review and writes review_note), but
-- may not approve it, re-assign it, or change its public id.
create or replace function public.applications_guard_student()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_officer() then
    return new;
  end if;

  if new.status = 'Approved (Demo)'
     and (tg_op = 'INSERT' or old.status is distinct from 'Approved (Demo)') then
    raise exception 'Only an officer can approve an application'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    new.submitted_at := now();
  else
    if new.user_id is distinct from old.user_id
       or new.application_id is distinct from old.application_id
       or new.submitted_at is distinct from old.submitted_at then
      raise exception 'user_id, application_id and submitted_at cannot be changed'
        using errcode = '42501';
    end if;
    if old.status = 'Approved (Demo)' and new.status is distinct from old.status then
      raise exception 'Only an officer can change an approved application'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists applications_guard_student on public.applications;
create trigger applications_guard_student
  before insert or update on public.applications
  for each row execute function public.applications_guard_student();

alter table public.applications enable row level security;
revoke all on public.applications from anon;
grant select, insert, update on public.applications to authenticated;

drop policy if exists "applications_select_own_or_officer" on public.applications;
create policy "applications_select_own_or_officer" on public.applications
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_officer()));

drop policy if exists "applications_insert_own" on public.applications;
create policy "applications_insert_own" on public.applications
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "applications_update_own_or_officer" on public.applications;
create policy "applications_update_own_or_officer" on public.applications
  for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_officer()))
  with check (user_id = (select auth.uid()) or (select public.is_officer()));

-- ---------------------------------------------------------------------------
-- application_documents
-- (source / issuer / ocr_confidence / image_quality are added by the
--  20260928120000 migration.)
-- ---------------------------------------------------------------------------
create table if not exists public.application_documents (
  id                 uuid primary key default gen_random_uuid(),
  application_id     uuid not null references public.applications (id) on delete cascade,
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  document_type      text not null,
  original_filename  text,
  storage_path       text,
  uploaded_at        timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

create index if not exists application_documents_application_id_idx
  on public.application_documents (application_id);
create index if not exists application_documents_user_id_idx
  on public.application_documents (user_id);

alter table public.application_documents enable row level security;
revoke all on public.application_documents from anon;
grant select, insert, update on public.application_documents to authenticated;

drop policy if exists "application_documents_select_own_or_officer" on public.application_documents;
create policy "application_documents_select_own_or_officer" on public.application_documents
  for select to authenticated
  using (
    (select public.is_officer())
    or exists (
      select 1 from public.applications a
      where a.id = application_documents.application_id
        and a.user_id = (select auth.uid())
    )
  );

drop policy if exists "application_documents_insert_own" on public.application_documents;
create policy "application_documents_insert_own" on public.application_documents
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.applications a
      where a.id = application_documents.application_id
        and a.user_id = (select auth.uid())
    )
  );

drop policy if exists "application_documents_update_own_or_officer" on public.application_documents;
create policy "application_documents_update_own_or_officer" on public.application_documents
  for update to authenticated
  using (
    (select public.is_officer())
    or exists (
      select 1 from public.applications a
      where a.id = application_documents.application_id
        and a.user_id = (select auth.uid())
    )
  )
  with check (
    (select public.is_officer())
    or (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.applications a
        where a.id = application_documents.application_id
          and a.user_id = (select auth.uid())
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Storage: private bucket "application-documents"
-- Object path: <auth.uid()>/<application uuid>/<Type>-<ts>-<file>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('application-documents', 'application-documents', false)
on conflict (id) do nothing;

drop policy if exists "app_docs_insert_own_folder" on storage.objects;
create policy "app_docs_insert_own_folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'application-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "app_docs_select_own_or_officer" on storage.objects;
create policy "app_docs_select_own_or_officer" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'application-documents'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_officer())
    )
  );
