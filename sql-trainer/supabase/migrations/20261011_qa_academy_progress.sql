-- Прогресс «Академии QA»: маги (имя + пароль) и их сессии.
-- Таблицы закрыты RLS без политик; браузер работает только через функции ниже.
create table if not exists public.qa_players (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  name_key    text generated always as (lower(btrim(name))) stored,
  pass_hash   text not null,
  state       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint qa_players_name_len check (char_length(btrim(name)) between 2 and 32)
);
create unique index if not exists qa_players_name_key on public.qa_players (name_key);

create table if not exists public.qa_sessions (
  token_hash   text primary key,
  player_id    uuid not null references public.qa_players(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index if not exists qa_sessions_player on public.qa_sessions (player_id);

alter table public.qa_players enable row level security;
alter table public.qa_sessions enable row level security;
revoke all on public.qa_players, public.qa_sessions from anon, authenticated;

-- Новая сессия: в базе хранится только хэш токена.
create or replace function public.qa_new_session(p_player uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into public.qa_sessions (token_hash, player_id)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_player);
  return v_token;
end;
$$;

create or replace function public.qa_session_player(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player uuid;
begin
  update public.qa_sessions
     set last_used_at = now()
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and last_used_at > now() - interval '90 days'
  returning player_id into v_player;
  if v_player is null then
    raise exception 'bad_session';
  end if;
  return v_player;
end;
$$;

create or replace function public.qa_register(p_name text, p_password text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_name is null or char_length(btrim(p_name)) not between 2 and 32 then
    raise exception 'bad_name';
  end if;
  if p_password is null or char_length(p_password) < 6 or char_length(p_password) > 128 then
    raise exception 'bad_password';
  end if;
  if exists (select 1 from public.qa_players where name_key = lower(btrim(p_name))) then
    raise exception 'name_taken';
  end if;
  insert into public.qa_players (name, pass_hash)
  values (btrim(p_name), extensions.crypt(p_password, extensions.gen_salt('bf', 8)))
  returning id into v_id;
  return json_build_object('token', public.qa_new_session(v_id), 'name', btrim(p_name), 'state', '{}'::jsonb);
end;
$$;

create or replace function public.qa_login(p_name text, p_password text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.qa_players;
begin
  select * into v_player from public.qa_players where name_key = lower(btrim(coalesce(p_name, '')));
  if v_player.id is null or v_player.pass_hash <> extensions.crypt(coalesce(p_password, ''), v_player.pass_hash) then
    raise exception 'bad_credentials';
  end if;
  return json_build_object('token', public.qa_new_session(v_player.id), 'name', v_player.name, 'state', v_player.state);
end;
$$;

create or replace function public.qa_load(p_token text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player public.qa_players;
begin
  select * into v_player from public.qa_players where id = public.qa_session_player(p_token);
  return json_build_object('name', v_player.name, 'state', v_player.state, 'updated_at', v_player.updated_at);
end;
$$;

create or replace function public.qa_save(p_token text, p_state jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'bad_state';
  end if;
  if octet_length(p_state::text) > 262144 then
    raise exception 'state_too_large';
  end if;
  update public.qa_players
     set state = p_state, updated_at = now()
   where id = public.qa_session_player(p_token)
  returning updated_at into v_at;
  return v_at;
end;
$$;

create or replace function public.qa_logout(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.qa_sessions
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- Наружу — только пять функций. Служебные недоступны.
revoke all on function public.qa_new_session(uuid), public.qa_session_player(text) from public, anon, authenticated;
revoke all on function public.qa_register(text, text), public.qa_login(text, text), public.qa_load(text),
  public.qa_save(text, jsonb), public.qa_logout(text) from public;
grant execute on function public.qa_register(text, text), public.qa_login(text, text), public.qa_load(text),
  public.qa_save(text, jsonb), public.qa_logout(text) to anon, authenticated;
