-- Profiles, settings, policy acceptances, admin roles
create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  first_name text not null default '',
  last_name text not null default '',
  display_name text not null default '',
  bio text not null default '',
  birth_date date,
  country text,
  city text,
  avatar_url text,
  is_private boolean not null default false,
  is_admin boolean not null default false,
  role text not null default 'user' check (role in ('user','moderator','admin','superadmin')),
  status text not null default 'active' check (status in ('active','restricted','suspended','banned')),
  last_seen_at timestamptz,
  online boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));
create index if not exists profiles_username_idx on public.profiles (username);

-- Username format + reserved names
create or replace function public.is_valid_username(u text)
returns boolean language sql immutable as $$
  select u ~ '^[a-zA-Z0-9_]{3,20}$'
     and lower(u) <> all (array['admin','administrator','moderator','support','official','eyye','system','root','null','undefined','eyyeapp','help','security','safety','api','www','app']);
$$;

create or replace function public.username_available(u text, exclude_user uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_valid_username(u)
     and not exists (
       select 1 from public.profiles p
       where lower(p.username) = lower(u)
         and (exclude_user is null or p.id <> exclude_user)
     );
$$;

create or replace function public.calculate_age(d date)
returns int language sql immutable as $$
  select case when d is null then null else
    extract(year from age(current_date, d))::int end;
$$;

-- Compute display fields on write
create or replace function public.profiles_before_write()
returns trigger language plpgsql as $$
begin
  new.username := lower(trim(new.username));
  if new.username is null or not public.is_valid_username(new.username) then
    raise exception 'invalid_username';
  end if;
  new.display_name := nullif(trim(coalesce(new.first_name,'') || ' ' || coalesce(new.last_name,'')), '');
  if new.display_name is null then new.display_name := new.username; end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_before_write_trg on public.profiles;
create trigger profiles_before_write_trg before insert or update on public.profiles
  for each row execute function public.profiles_before_write();

-- Auto-create profile on signup from auth metadata
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, username, first_name, last_name, birth_date, country, city, avatar_url)
  values (
    new.id,
    coalesce(meta->>'username', 'user_' || substr(replace(new.id::text,'-',''),1,10)),
    coalesce(meta->>'first_name',''),
    coalesce(meta->>'last_name',''),
    nullif(meta->>'birth_date','')::date,
    meta->>'country',
    meta->>'city',
    meta->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 18+ enforcement server-side
create or replace function public.enforce_adult(d date)
returns void language plpgsql immutable as $$
begin
  if d is not null and public.calculate_age(d) < 18 then
    raise exception 'underage';
  end if;
end $$;

create or replace function public.profiles_check_age()
returns trigger language plpgsql as $$
begin
  perform public.enforce_adult(new.birth_date);
  return new;
end $$;

drop trigger if exists profiles_check_age_trg on public.profiles;
create trigger profiles_check_age_trg before insert or update of birth_date on public.profiles
  for each row execute function public.profiles_check_age();

create table if not exists public.profile_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  url text not null,
  position int not null default 0,
  is_main boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists profile_photos_user_pos_idx on public.profile_photos (user_id, position);
create unique index if not exists profile_photos_one_main_idx on public.profile_photos (user_id) where is_main;

create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null default 'modernSocial',
  language text,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_privacy_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  private_account boolean not null default false,
  who_can_message text not null default 'everyone' check (who_can_message in ('everyone','followers','nobody')),
  who_can_follow text not null default 'everyone' check (who_can_follow in ('everyone','followers','nobody')),
  show_online boolean not null default true,
  show_last_seen boolean not null default true,
  read_receipts boolean not null default true,
  allow_mentions boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  messages boolean not null default true,
  followers boolean not null default true,
  likes boolean not null default true,
  comments boolean not null default true,
  mentions boolean not null default true,
  game_invites boolean not null default true,
  group_invites boolean not null default true,
  safety_updates boolean not null default true,
  marketing boolean not null default false,
  hide_message_preview boolean not null default false,
  quiet_hours_enabled boolean not null default false,
  quiet_hours_start time,
  quiet_hours_end time,
  updated_at timestamptz not null default now()
);

create table if not exists public.policy_versions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  version text not null,
  locale text not null default 'en',
  title text not null,
  body text not null,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.user_policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  policy_slug text not null,
  policy_version text not null,
  accepted_at timestamptz not null default now(),
  ip inet,
  user_agent text,
  unique (user_id, policy_slug, policy_version)
);

create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  push_token text not null,
  platform text not null check (platform in ('ios','android','web')),
  device_name text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, push_token)
);

create table if not exists public.user_email_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  is_primary boolean not null default false,
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, email)
);

-- Admin / moderation roles
create table if not exists public.moderation_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('moderator','admin','superadmin','child_safety_officer')),
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, role)
);

create or replace function public.current_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.moderation_roles
      where user_id = auth.uid() and revoked_at is null
      order by case role when 'superadmin' then 0 when 'admin' then 1 when 'child_safety_officer' then 2 else 3 end
      limit 1),
    (select role from public.profiles where id = auth.uid())
  );
$$;

create or replace function public.is_moderator()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role() in ('moderator','admin','superadmin','child_safety_officer');
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role() in ('admin','superadmin');
$$;

create or replace function public.can_access_child_safety()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role() in ('admin','superadmin','child_safety_officer');
$$;

-- RLS
alter table public.profiles enable row level security;
alter table public.profile_photos enable row level security;
alter table public.user_settings enable row level security;
alter table public.user_privacy_settings enable row level security;
alter table public.user_notification_preferences enable row level security;
alter table public.user_devices enable row level security;
alter table public.user_email_addresses enable row level security;
alter table public.policy_versions enable row level security;
alter table public.user_policy_acceptances enable row level security;
alter table public.moderation_roles enable row level security;

create policy "profiles_read" on public.profiles for select to authenticated using (true);
create policy "profiles_insert_self" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_self" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_admin_update" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "photos_read" on public.profile_photos for select to authenticated using (true);
create policy "photos_write_self" on public.profile_photos for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "settings_read_self" on public.user_settings for select to authenticated using (user_id = auth.uid());
create policy "settings_write_self" on public.user_settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "privacy_read_self" on public.user_privacy_settings for select to authenticated using (user_id = auth.uid());
create policy "privacy_write_self" on public.user_privacy_settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "notifprefs_read_self" on public.user_notification_preferences for select to authenticated using (user_id = auth.uid());
create policy "notifprefs_write_self" on public.user_notification_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "devices_read_self" on public.user_devices for select to authenticated using (user_id = auth.uid());
create policy "devices_write_self" on public.user_devices for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "emails_read_self" on public.user_email_addresses for select to authenticated using (user_id = auth.uid());
create policy "emails_write_self" on public.user_email_addresses for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "policy_versions_read" on public.policy_versions for select to anon, authenticated using (true);

create policy "acceptances_read_self" on public.user_policy_acceptances for select to authenticated using (user_id = auth.uid());
create policy "acceptances_insert_self" on public.user_policy_acceptances for insert to authenticated with check (user_id = auth.uid());

create policy "roles_read_mod" on public.moderation_roles for select to authenticated using (public.is_moderator() or user_id = auth.uid());
create policy "roles_write_admin" on public.moderation_roles for all to authenticated using (public.is_admin()) with check (public.is_admin());
