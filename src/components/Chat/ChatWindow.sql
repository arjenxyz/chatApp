-- src/components/Chat/ChatWindow.sql
-- Conversations + Participants + Messages tabloları, RLS ve Realtime ayarları

begin;

create extension if not exists "pgcrypto";

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  is_group boolean not null default false,
  name text
);
alter table public.conversations add column if not exists pinned boolean not null default false;
alter table public.conversations add column if not exists owner_id uuid references public.profiles (id) on delete set null;
alter table public.conversations alter column owner_id set default auth.uid();
create index if not exists conversations_pinned_idx on public.conversations (pinned);
create index if not exists conversations_owner_id_idx on public.conversations (owner_id);

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
  type text not null default 'text',
  created_at timestamptz not null default now(),
  is_read boolean not null default false
);
alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages add constraint messages_type_check check (type in ('text', 'image', 'sticker'));

create table if not exists public.stickers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_url text not null,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists stickers_created_at_idx on public.stickers (created_at desc);

alter table public.messages add column if not exists replied_to uuid references public.messages (id) on delete set null;
alter table public.messages add column if not exists sticker_id uuid references public.stickers (id) on delete set null;
-- flag used when a user deletes a message; we keep the row and show placeholder in UI
alter table public.messages add column if not exists deleted boolean not null default false;
-- flag to mark a message that has been edited
alter table public.messages add column if not exists edited boolean not null default false;
alter table public.messages add column if not exists media_url text;
create index if not exists messages_edited_idx on public.messages (edited);
alter table public.messages replica identity full;
create index if not exists messages_conversation_id_created_at_idx on public.messages (conversation_id, created_at);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);
create index if not exists push_subscriptions_updated_at_idx on public.push_subscriptions (updated_at desc);

create table if not exists public.conversation_notification_settings (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  muted boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);
create index if not exists conversation_notification_settings_user_id_idx
  on public.conversation_notification_settings (user_id);
create index if not exists conversation_notification_settings_conversation_id_idx
  on public.conversation_notification_settings (conversation_id);

create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocker_id_idx on public.user_blocks (blocker_id);
create index if not exists user_blocks_blocked_id_idx on public.user_blocks (blocked_id);

grant select, insert, update, delete on table public.conversations to authenticated;
grant select, insert, update, delete on table public.participants to authenticated;
grant select, insert, update, delete on table public.messages to authenticated;
grant select, insert, update, delete on table public.stickers to authenticated;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;
grant select, insert, update, delete on table public.conversation_notification_settings to authenticated;
grant select, insert, update, delete on table public.user_blocks to authenticated;

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

alter table public.conversations enable row level security;
alter table public.participants enable row level security;
alter table public.messages enable row level security;
alter table public.stickers enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.conversation_notification_settings enable row level security;
alter table public.user_blocks enable row level security;

create or replace function public.is_conversation_member(p_conversation uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.participants
    where conversation_id = p_conversation
      and user_id = auth.uid()
  );
$$;

revoke all on function public.is_conversation_member(uuid) from public;
grant execute on function public.is_conversation_member(uuid) to authenticated;

create or replace function public.is_user_blocked(p_user uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = p_user)
       or (b.blocker_id = p_user and b.blocked_id = auth.uid())
  );
$$;

revoke all on function public.is_user_blocked(uuid) from public;
grant execute on function public.is_user_blocked(uuid) to authenticated;

create or replace function public.conversation_has_block_between(p_conversation uuid, p_actor uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.participants other_participant
    join public.user_blocks b
      on (
        (b.blocker_id = p_actor and b.blocked_id = other_participant.user_id)
        or
        (b.blocker_id = other_participant.user_id and b.blocked_id = p_actor)
      )
    where other_participant.conversation_id = p_conversation
      and other_participant.user_id <> p_actor
  );
$$;

revoke all on function public.conversation_has_block_between(uuid, uuid) from public;
grant execute on function public.conversation_has_block_between(uuid, uuid) to authenticated;

drop policy if exists "Conversations are viewable by participants" on public.conversations;
create policy "Conversations are viewable by participants"
on public.conversations
for select
to authenticated
using (public.is_conversation_member(id) or owner_id = auth.uid());

drop policy if exists "Authenticated users can create conversations" on public.conversations;
create policy "Authenticated users can create conversations"
on public.conversations
for insert
to authenticated
with check (auth.uid() is not null and owner_id = auth.uid());

drop policy if exists "Participants can delete conversations" on public.conversations;
create policy "Participants can delete conversations"
on public.conversations
for delete
to authenticated
using (public.is_conversation_member(id) or owner_id = auth.uid());

drop policy if exists "Participants are viewable by conversation members" on public.participants;
create policy "Participants are viewable by conversation members"
on public.participants
for select
to authenticated
using (public.is_conversation_member(conversation_id));

drop policy if exists "Users can join new conversations and invite others" on public.participants;
create policy "Users can join new conversations and invite others"
on public.participants
for insert
to authenticated
with check (
  auth.uid() is not null
  and (
    (
      user_id = auth.uid()
      and not exists (
        select 1 from public.participants p0
        where p0.conversation_id = conversation_id
      )
    )
    or exists (
      select 1 from public.participants p1
      where p1.conversation_id = conversation_id
        and p1.user_id = auth.uid()
    )
  )
  and not exists (
    select 1
    from public.user_blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = participants.user_id)
       or (b.blocker_id = participants.user_id and b.blocked_id = auth.uid())
  )
);

drop policy if exists "Users can leave conversations" on public.participants;
create policy "Users can leave conversations"
on public.participants
for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "Messages are viewable by participants" on public.messages;
create policy "Messages are viewable by participants"
on public.messages
for select
to authenticated
using (public.is_conversation_member(conversation_id));

drop policy if exists "Participants can send messages" on public.messages;
create policy "Participants can send messages"
on public.messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and public.is_conversation_member(conversation_id)
  and not public.conversation_has_block_between(conversation_id, auth.uid())
  and (
    replied_to is null
    or exists (
      select 1 from public.messages m
      where m.id = messages.replied_to
        and m.conversation_id = messages.conversation_id
    )
  )
);

drop policy if exists "Users can edit own messages" on public.messages;
create policy "Users can edit own messages"
on public.messages
for update
to authenticated
using (sender_id = auth.uid())
with check (sender_id = auth.uid());

drop policy if exists "Users can delete own messages" on public.messages;
create policy "Users can delete own messages"
on public.messages
for delete
to authenticated
using (sender_id = auth.uid());

drop policy if exists "Authenticated users can view stickers" on public.stickers;
create policy "Authenticated users can view stickers"
on public.stickers
for select
to authenticated
using (true);

drop policy if exists "Users can add own stickers" on public.stickers;
create policy "Users can add own stickers"
on public.stickers
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "Users can update own stickers" on public.stickers;
create policy "Users can update own stickers"
on public.stickers
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists "Users can delete own stickers" on public.stickers;
create policy "Users can delete own stickers"
on public.stickers
for delete
to authenticated
using (created_by = auth.uid());

drop policy if exists "Users can view own push subscriptions" on public.push_subscriptions;
create policy "Users can view own push subscriptions"
on public.push_subscriptions
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can insert own push subscriptions" on public.push_subscriptions;
create policy "Users can insert own push subscriptions"
on public.push_subscriptions
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update own push subscriptions" on public.push_subscriptions;
create policy "Users can update own push subscriptions"
on public.push_subscriptions
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can delete own push subscriptions" on public.push_subscriptions;
create policy "Users can delete own push subscriptions"
on public.push_subscriptions
for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can view own notification settings" on public.conversation_notification_settings;
create policy "Users can view own notification settings"
on public.conversation_notification_settings
for select
to authenticated
using (user_id = auth.uid() and public.is_conversation_member(conversation_id));

drop policy if exists "Users can insert own notification settings" on public.conversation_notification_settings;
create policy "Users can insert own notification settings"
on public.conversation_notification_settings
for insert
to authenticated
with check (user_id = auth.uid() and public.is_conversation_member(conversation_id));

drop policy if exists "Users can update own notification settings" on public.conversation_notification_settings;
create policy "Users can update own notification settings"
on public.conversation_notification_settings
for update
to authenticated
using (user_id = auth.uid() and public.is_conversation_member(conversation_id))
with check (user_id = auth.uid() and public.is_conversation_member(conversation_id));

drop policy if exists "Users can delete own notification settings" on public.conversation_notification_settings;
create policy "Users can delete own notification settings"
on public.conversation_notification_settings
for delete
to authenticated
using (user_id = auth.uid() and public.is_conversation_member(conversation_id));

drop policy if exists "Users can view relevant block rows" on public.user_blocks;
create policy "Users can view relevant block rows"
on public.user_blocks
for select
to authenticated
using (blocker_id = auth.uid() or blocked_id = auth.uid());

drop policy if exists "Users can create own block rows" on public.user_blocks;
create policy "Users can create own block rows"
on public.user_blocks
for insert
to authenticated
with check (blocker_id = auth.uid() and blocker_id <> blocked_id);

drop policy if exists "Users can delete own block rows" on public.user_blocks;
create policy "Users can delete own block rows"
on public.user_blocks
for delete
to authenticated
using (blocker_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  true,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Chat media read access" on storage.objects;
create policy "Chat media read access"
on storage.objects
for select
to authenticated
using (bucket_id = 'chat-media');

drop policy if exists "Chat media upload access" on storage.objects;
create policy "Chat media upload access"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'chat-media' and auth.uid() is not null);

drop policy if exists "Chat media update own files" on storage.objects;
create policy "Chat media update own files"
on storage.objects
for update
to authenticated
using (bucket_id = 'chat-media' and owner = auth.uid())
with check (bucket_id = 'chat-media' and owner = auth.uid());

drop policy if exists "Chat media delete own files" on storage.objects;
create policy "Chat media delete own files"
on storage.objects
for delete
to authenticated
using (bucket_id = 'chat-media' and owner = auth.uid());

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

  if not public.is_conversation_member(p_conversation_id) then
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
