-- Safety reports, moderation workflow, audit logs, escalations
create table if not exists public.safety_reports (
  id uuid primary key default gen_random_uuid(),
  report_number text not null unique,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  category text not null check (category in (
    'child_safety','sexual_exploitation','harassment','threats','fraud','spam',
    'fake_account','hate_speech','nonconsensual_intimate','inappropriate',
    'privacy_violation','other')),
  priority text not null default 'normal' check (priority in ('critical','high','medium','normal')),
  status text not null default 'received' check (status in (
    'received','pre_review','in_review','needs_info','resolved','closed','appeal_review')),
  subject_type text not null default 'user',
  details text,
  auto_flagged boolean not null default false,
  assigned_to uuid references public.profiles(id),
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists safety_reports_status_idx on public.safety_reports (status, priority);
create index if not exists safety_reports_reporter_idx on public.safety_reports (reporter_id);
create index if not exists safety_reports_reported_idx on public.safety_reports (reported_user_id);

create or replace function public.safety_reports_number()
returns trigger language plpgsql as $$
begin
  if new.report_number is null or new.report_number = '' then
    new.report_number := 'RPT-' || to_char(now(),'YYYYMMDD') || '-' ||
      upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  end if;
  return new;
end $$;
drop trigger if exists safety_reports_number_trg on public.safety_reports;
create trigger safety_reports_number_trg before insert on public.safety_reports
  for each row execute function public.safety_reports_number();

-- Auto priority: child_safety => critical
create or replace function public.safety_reports_priority()
returns trigger language plpgsql as $$
begin
  if new.category = 'child_safety' then new.priority := 'critical';
  elsif new.category in ('sexual_exploitation','threats') then
    new.priority := case when new.priority = 'normal' then 'high' else new.priority end;
  end if;
  return new;
end $$;
drop trigger if exists safety_reports_priority_trg on public.safety_reports;
create trigger safety_reports_priority_trg before insert on public.safety_reports
  for each row execute function public.safety_reports_priority();

create table if not exists public.safety_report_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.safety_reports(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  type text not null,
  from_status text,
  to_status text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sre_report_idx on public.safety_report_events (report_id, created_at);

create table if not exists public.safety_report_evidence (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.safety_reports(id) on delete cascade,
  kind text not null default 'text',
  storage_path text,
  description text,
  access_restricted boolean not null default true,
  retention_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.safety_report_assignments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.safety_reports(id) on delete cascade,
  moderator_id uuid not null references public.profiles(id),
  assigned_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  released_at timestamptz
);

create table if not exists public.safety_report_messages (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.safety_reports(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  sender_role text not null default 'reporter' check (sender_role in ('reporter','reported','moderator','system')),
  body text not null,
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.safety_report_appeals (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.safety_reports(id) on delete cascade,
  appellant_id uuid not null references public.profiles(id),
  reason text not null,
  status text not null default 'pending' check (status in ('pending','in_review','accepted','rejected')),
  reviewed_by uuid references public.profiles(id),
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id),
  action text not null,
  target_user_id uuid references public.profiles(id),
  target_report_id uuid references public.safety_reports(id),
  reason text,
  payload jsonb not null default '{}'::jsonb,
  requires_second_approval boolean not null default false,
  approved_by uuid references public.profiles(id),
  reversible_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.moderation_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  ip inet,
  created_at timestamptz not null default now()
);

create table if not exists public.safety_escalations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.safety_reports(id) on delete cascade,
  reason text not null,
  escalated_by uuid references public.profiles(id),
  assigned_to uuid references public.profiles(id),
  status text not null default 'open' check (status in ('open','acknowledged','resolved')),
  legal_notified boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.safety_policy_versions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  version text not null,
  body text not null,
  created_at timestamptz not null default now()
);

-- Status transition helper used by client RPCs
create or replace function public.moderation_update_report(
  p_report_id uuid,
  p_status text default null,
  p_priority text default null,
  p_assigned_to uuid default null,
  p_note text default null
) returns public.safety_reports
language plpgsql security definer set search_path = public as $$
declare
  r public.safety_reports;
begin
  if not public.is_moderator() then raise exception 'forbidden'; end if;
  select * into r from public.safety_reports where id = p_report_id for update;
  if r.id is null then raise exception 'not_found'; end if;

  if p_status is not null and p_status <> r.status then
    insert into public.safety_report_events (report_id, actor_id, type, from_status, to_status, note)
    values (r.id, auth.uid(), 'status_change', r.status, p_status, p_note);
    r.status := p_status;
    if p_status in ('resolved','closed') then r.resolved_at := now(); end if;
  end if;
  if p_priority is not null then r.priority := p_priority; end if;
  if p_assigned_to is not null then r.assigned_to := p_assigned_to; end if;
  r.updated_at := now();

  update public.safety_reports set
    status = r.status, priority = r.priority, assigned_to = r.assigned_to,
    resolved_at = r.resolved_at, updated_at = now()
  where id = r.id returning * into r;
  return r;
end $$;

create or replace function public.moderation_add_action(
  p_action text,
  p_target_user uuid default null,
  p_target_report uuid default null,
  p_reason text default null,
  p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  aid uuid;
  severe boolean := p_action in ('suspend','ban','restrict','remove_content');
begin
  if not public.is_moderator() then raise exception 'forbidden'; end if;
  insert into public.moderation_actions (actor_id, action, target_user_id, target_report_id, reason, payload, requires_second_approval)
  values (auth.uid(), p_action, p_target_user, p_target_report, p_reason, p_payload, severe)
  returning id into aid;
  insert into public.moderation_audit_logs (actor_id, action, entity_type, entity_id, after)
  values (auth.uid(), p_action, 'moderation_action', aid::text, jsonb_build_object('target_user', p_target_user, 'report', p_target_report, 'reason', p_reason));
  if p_target_report is not null then
    insert into public.safety_report_events (report_id, actor_id, type, note)
    values (p_target_report, auth.uid(), 'moderator_action', p_action || ': ' || coalesce(p_reason,''));
  end if;
  return aid;
end $$;

create or replace function public.category_check(rid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.safety_reports where id = rid and category <> 'child_safety');
$$;

-- RLS
alter table public.safety_reports enable row level security;
alter table public.safety_report_events enable row level security;
alter table public.safety_report_evidence enable row level security;
alter table public.safety_report_assignments enable row level security;
alter table public.safety_report_messages enable row level security;
alter table public.safety_report_appeals enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.moderation_audit_logs enable row level security;
alter table public.safety_escalations enable row level security;
alter table public.safety_policy_versions enable row level security;

create policy "reports_insert_self" on public.safety_reports for insert to authenticated
  with check (reporter_id = auth.uid());
create policy "reports_read_own" on public.safety_reports for select to authenticated
  using (reporter_id = auth.uid() or reported_user_id = auth.uid() or public.is_moderator());
create policy "reports_update_mod" on public.safety_reports for update to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

create policy "events_read" on public.safety_report_events for select to authenticated
  using (exists (select 1 from public.safety_reports r where r.id = report_id
    and (r.reporter_id = auth.uid() or r.reported_user_id = auth.uid() or public.is_moderator())));
create policy "events_insert_mod" on public.safety_report_events for insert to authenticated
  with check (public.is_moderator() or exists (select 1 from public.safety_reports r where r.id = report_id and r.reporter_id = auth.uid()));

create policy "evidence_mod" on public.safety_report_evidence for all to authenticated
  using (public.is_moderator() and (not access_restricted or public.can_access_child_safety() or category_check(report_id)))
  with check (public.is_moderator());

create policy "assignments_mod" on public.safety_report_assignments for all to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

create policy "report_msgs_read" on public.safety_report_messages for select to authenticated
  using (exists (select 1 from public.safety_reports r where r.id = report_id
    and (r.reporter_id = auth.uid() or r.reported_user_id = auth.uid() or public.is_moderator()))
    and (not is_internal or public.is_moderator()));
create policy "report_msgs_insert" on public.safety_report_messages for insert to authenticated
  with check (sender_id = auth.uid() and (public.is_moderator() or exists (
    select 1 from public.safety_reports r where r.id = report_id
      and (r.reporter_id = auth.uid() or r.reported_user_id = auth.uid()))));

create policy "appeals_rw" on public.safety_report_appeals for all to authenticated
  using (appellant_id = auth.uid() or public.is_moderator())
  with check (appellant_id = auth.uid() or public.is_moderator());

create policy "actions_mod" on public.moderation_actions for select to authenticated
  using (public.is_moderator() or actor_id = auth.uid());
create policy "actions_insert_mod" on public.moderation_actions for insert to authenticated
  with check (public.is_moderator());

create policy "audit_mod_read" on public.moderation_audit_logs for select to authenticated
  using (public.is_admin());
create policy "audit_no_client_write" on public.moderation_audit_logs for insert to authenticated
  with check (false);

create policy "escalations_mod" on public.safety_escalations for all to authenticated
  using (public.can_access_child_safety() or public.is_admin())
  with check (public.can_access_child_safety() or public.is_admin());

create policy "safety_policies_read" on public.safety_policy_versions for select to anon, authenticated using (true);

do $$ begin alter publication supabase_realtime add table public.safety_reports; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.notifications; exception when others then null; end $$;
