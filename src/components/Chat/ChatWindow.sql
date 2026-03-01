-- src/components/Chat/ChatWindow.sql
-- Conversations + Participants + Messages tabloları, RLS ve Realtime ayarları

begin;

create extension if not exists "pgcrypto";

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  is_group boolean not null default false,
  name text,
  pinned boolean not null default false
);
create index if not exists conversations_pinned_idx on public.conversations (pinned);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  unique (conversation_id, user_id)
);

create index if not exists participants_conversation_id_idx on public.participants (conversation_id);
create index if not exists participants_user_id_idx on public.participants (user_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  content text not null,
  type text not null default 'text' check (type in ('text', 'image')),
  replied_to uuid references public.messages (id) on delete set null,
  created_at timestamptz not null default now(),
  is_read boolean not null default false
);

create index if not exists messages_conversation_id_created_at_idx on public.messages (conversation_id, created_at);

-- Uygulama rolleri (Supabase client JWT) için izinler
grant select, insert, update, delete on table public.conversations to authenticated;
grant select, insert, update, delete on table public.participants to authenticated;
grant select, insert, update, delete on table public.messages to authenticated;

-- Realtime (postgres_changes) için tabloyu yayına ekle (idempotent)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'messages'
    ) then
      execute 'alter publication supabase_realtime add table public.messages';
    end if;
  end if;
end $$;

-- RLS
alter table public.conversations enable row level security;
alter table public.participants enable row level security;
alter table public.messages enable row level security;

-- helper to check membership without triggering the participants RLS policy
-- itself. this function runs with security definer privileges so that the
-- recursive self-join in the policy below does not re‑invoke the policy.
create or replace function public.is_conversation_member(p_conversation uuid)
returns boolean
language sql
security definer
as $$
  select exists (
    select 1 from public.participants
    where conversation_id = p_conversation
      and user_id = auth.uid()
  );
$$;


-- Conversations
drop policy if exists "Conversations are viewable by participants" on public.conversations;
create policy "Conversations are viewable by participants"
on public.conversations
for select
to authenticated
using (
  exists (
    select 1 from public.participants p
    where p.conversation_id = conversations.id
      and p.user_id = auth.uid()
  )
);

drop policy if exists "Authenticated users can create conversations" on public.conversations;
create policy "Authenticated users can create conversations"
on public.conversations
for insert
to authenticated
with check (true);  -- allow any authenticated session (uid may not be set yet)

-- Participants
drop policy if exists "Participants are viewable by conversation members" on public.participants;
create policy "Participants are viewable by conversation members"
on public.participants
for select
to authenticated
using (
  public.is_conversation_member(conversation_id)
);

drop policy if exists "Users can join new conversations and invite others" on public.participants;
create policy "Users can join new conversations and invite others"
on public.participants
for insert
to authenticated
with check (
  auth.uid() is not null
  and (
    -- İlk katılımcı sadece kendisi olabilir (konuşmada henüz participant yoksa)
    (user_id = auth.uid() and not exists (
      select 1 from public.participants p0
      where p0.conversation_id = conversation_id
    ))
    -- Zaten katılımcı olan kullanıcı başkalarını ekleyebilir
    or exists (
      select 1 from public.participants p1
      where p1.conversation_id = conversation_id
        and p1.user_id = auth.uid()
    )
  )
);

drop policy if exists "Users can leave conversations" on public.participants;
create policy "Users can leave conversations"
on public.participants
for delete
to authenticated
using (user_id = auth.uid());

-- Messages
drop policy if exists "Messages are viewable by participants" on public.messages;
create policy "Messages are viewable by participants"
on public.messages
for select
to authenticated
using (
  exists (
    select 1 from public.participants p
    where p.conversation_id = messages.conversation_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists "Participants can send messages" on public.messages;
create policy "Participants can send messages"
on public.messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.participants p
    where p.conversation_id = messages.conversation_id
      and p.user_id = auth.uid()
  )
  and (
    replied_to is null
    or exists (
      select 1 from public.messages m
      where m.id = messages.replied_to
        and m.conversation_id = messages.conversation_id
    )
  )
    where p.conversation_id = messages.conversation_id
      and p.user_id = auth.uid()
  )
);

-- let participants delete entire conversation (will cascade to messages/participants)
drop policy if exists "Participants can delete conversations" on public.conversations;
create policy "Participants can delete conversations"
on public.conversations
for delete
to authenticated
using (
  exists (
    select 1 from public.participants p
    where p.conversation_id = conversations.id
      and p.user_id = auth.uid()
  )
);

-- Okundu bilgisini güvenli şekilde işaretlemek için RPC (security definer)
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.participants p
    where p.conversation_id = p_conversation_id
      and p.user_id = auth.uid()
  ) then
    raise exception 'not a participant';
  end if;

  update public.messages
    set is_read = true
  where conversation_id = p_conversation_id
    and sender_id <> auth.uid()
    and is_read = false;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

commit;
