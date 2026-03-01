-- src/app/auth/login/login.sql
-- Profiles tablosu + Auth trigger'ları + RLS

begin;

-- Gerekli uzantı (UUID üretimi için)
create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  avatar_url text,
  full_name text,
  updated_at timestamptz not null default now(),
  status text not null default 'offline' check (status in ('online', 'offline'))
);

grant select, insert, update on table public.profiles to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

-- Auth kullanıcısı oluştuğunda profile kaydı aç
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  desired_username text;
begin
  desired_username := nullif(lower(trim(new.raw_user_meta_data->>'username')), '');

  begin
    insert into public.profiles (id, username, full_name, avatar_url, status)
    values (
      new.id,
      desired_username,
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'avatar_url',
      'offline'
    )
    on conflict (id) do nothing;
  exception
    when unique_violation then
      insert into public.profiles (id, username, full_name, avatar_url, status)
      values (
        new.id,
        null,
        new.raw_user_meta_data->>'full_name',
        new.raw_user_meta_data->>'avatar_url',
        'offline'
      )
      on conflict (id) do nothing;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;

drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
create policy "Profiles are viewable by authenticated users"
on public.profiles
for select
to authenticated
using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

commit;
