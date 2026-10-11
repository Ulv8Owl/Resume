-- Аккаунты Академии QA переезжают в Supabase Auth.
-- Регистрация по-прежнему только по никнейму и паролю: адрес почты для Auth генерируется из id пользователя
-- и нигде не показывается, а пользователь создаётся уже подтверждённым — писем и подтверждений нет.
-- Прогресс хранится в qa_progress и доступен только своему владельцу (RLS по auth.uid()).

create table if not exists public.qa_progress (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  nickname     text not null,
  nickname_key text generated always as (lower(btrim(nickname))) stored,
  state        jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  constraint qa_progress_nickname_ok check (btrim(nickname) ~ '^[A-Za-zА-Яа-яЁё0-9_ -]{2,32}$'),
  constraint qa_progress_state_size check (octet_length(state::text) <= 262144)
);
create unique index if not exists qa_progress_nickname_key on public.qa_progress (nickname_key);

alter table public.qa_progress enable row level security;
revoke all on public.qa_progress from anon, authenticated;
grant select, update (state, updated_at) on public.qa_progress to authenticated;

create policy "qa_progress: читать свой прогресс" on public.qa_progress
  for select to authenticated using (user_id = (select auth.uid()));
create policy "qa_progress: сохранять свой прогресс" on public.qa_progress
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Служебный адрес почты для Auth: из id, чтобы никнейм на кириллице не мешал формату почты.
create or replace function public.qa_auth_email_for(p_user uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'u' || replace(p_user::text, '-', '') || '@players.qa-academy.app';
$$;

-- Создать пользователя Auth сразу подтверждённым. p_hash — готовый bcrypt-хэш пароля.
create or replace function public.qa_create_auth_user(p_id uuid, p_nickname text, p_hash text, p_created timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.qa_auth_email_for(p_id);
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', v_email, p_hash, p_created,
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('display_name', btrim(p_nickname), 'nickname', btrim(p_nickname)),
    p_created, p_created, '', '', '', ''
  );
  insert into auth.identities (user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (p_id, p_id::text, 'email',
          jsonb_build_object('sub', p_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          p_created, p_created, p_created);
end;
$$;

-- Регистрация: проверяет никнейм, создаёт пользователя Auth и строку прогресса. Возвращает служебный адрес для входа.
create or replace function public.qa_register(p_name text, p_password text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if not public.qa_valid_name(p_name) then
    raise exception 'bad_name';
  end if;
  if p_password is null or char_length(p_password) < 6 or char_length(p_password) > 72 then
    raise exception 'bad_password';
  end if;
  if exists (select 1 from public.qa_progress where nickname_key = lower(btrim(p_name))) then
    raise exception 'name_taken';
  end if;
  perform public.qa_create_auth_user(v_id, p_name, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now());
  insert into public.qa_progress (user_id, nickname) values (v_id, btrim(p_name));
  return json_build_object('email', public.qa_auth_email_for(v_id), 'name', btrim(p_name));
exception
  when unique_violation then raise exception 'name_taken';
end;
$$;

-- Вход: по никнейму находит служебный адрес. Пароль проверяет сам Supabase Auth.
create or replace function public.qa_login_email(p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email from public.qa_progress p join auth.users u on u.id = p.user_id
   where p.nickname_key = lower(btrim(coalesce(p_name, '')));
$$;

create or replace function public.qa_name_available(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.qa_valid_name(p_name)
     and not exists (select 1 from public.qa_progress where nickname_key = lower(btrim(p_name)));
$$;

-- Перенос уже зарегистрированных магов: тот же пароль (bcrypt-хэш переносится как есть) и тот же прогресс.
do $$
declare
  r record;
begin
  for r in select * from public.qa_players p
           where not exists (select 1 from public.qa_progress g where g.nickname_key = p.name_key) loop
    perform public.qa_create_auth_user(r.id, r.name, r.pass_hash, r.created_at);
    insert into public.qa_progress (user_id, nickname, state, updated_at) values (r.id, r.name, r.state, r.updated_at);
  end loop;
end $$;

-- Старые функции входа через собственные сессии больше не доступны снаружи.
revoke all on function public.qa_login(text, text), public.qa_load(text), public.qa_save(text, jsonb), public.qa_logout(text)
  from anon, authenticated;
revoke all on function public.qa_create_auth_user(uuid, text, text, timestamptz), public.qa_auth_email_for(uuid) from public, anon, authenticated;
revoke all on function public.qa_register(text, text), public.qa_login_email(text), public.qa_name_available(text) from public;
grant execute on function public.qa_register(text, text), public.qa_login_email(text), public.qa_name_available(text) to anon, authenticated;
