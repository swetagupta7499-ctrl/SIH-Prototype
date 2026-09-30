-- ---------------------------------------------------------------------------
-- Officer status-change audit log
--
-- An append-only trail of every application status change made in the Officer
-- Portal: which application, old -> new status, who changed it and when.
-- Officers can read the whole log; inserts are restricted to officers.
-- Rows are immutable (no update/delete policies), giving a tamper-evident
-- audit trail for the demo.
-- ---------------------------------------------------------------------------

create table if not exists public.status_audit_log (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  old_status     text,
  new_status     text not null,
  changed_by     uuid default auth.uid() references auth.users (id) on delete set null,
  changed_at     timestamptz not null default now()
);

create index if not exists status_audit_log_application_idx
  on public.status_audit_log (application_id, changed_at desc);

alter table public.status_audit_log enable row level security;

-- Officers can read the full audit trail.
create policy "status_audit_log_select_officer" on public.status_audit_log
  for select
  using ((select public.is_officer()));

-- Only officers may append entries; changed_by is forced to the caller.
create policy "status_audit_log_insert_officer" on public.status_audit_log
  for insert
  with check ((select public.is_officer()) and changed_by = (select auth.uid()));

-- No update/delete policies: the log is append-only (immutable) under RLS.
