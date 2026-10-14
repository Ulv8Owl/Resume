-- Аккаунты Академии QA — пользователи Supabase Auth.
-- Регистрация по-прежнему только по никнейму и паролю: адрес почты для Auth генерируется из id пользователя
-- и нигде не показывается, а пользователь создаётся уже подтверждённым — писем и подтверждений нет.
-- Прогресс хранится в qa_progress и доступен только своему владельцу (RLS по auth.uid()).
-- Это единственная миграция Академии: она описывает всю схему целиком.
-- Её можно запускать сколько угодно раз — она ничего не удаляет и не ломает уже созданное,
-- а если функции в базе были заменены чем-то старым, возвращает правильные версии.

-- Правила никнейма: 2–32 символа, латиница, кириллица, цифры, пробел, «-» и «_».
create or replace function public.qa_valid_name(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_name is not null and btrim(p_name) ~ '^[A-Za-zА-Яа-яЁё0-9_ -]{2,32}$';
$$;

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

-- Политики создаются, только если их ещё нет: миграцию можно запускать повторно.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'qa_progress'
                 and policyname = 'qa_progress: читать свой прогресс') then
    create policy "qa_progress: читать свой прогресс" on public.qa_progress
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'qa_progress'
                 and policyname = 'qa_progress: сохранять свой прогресс') then
    create policy "qa_progress: сохранять свой прогресс" on public.qa_progress
      for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;

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

-- Смена никнейма: меняется ник в прогрессе и отображаемое имя в Auth. Почта для входа не меняется (она из id),
-- а вход по никнейму сразу работает с новым именем: qa_login_email ищет по qa_progress.
create or replace function public.qa_rename(p_name text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := auth.uid();
begin
  if v_id is null then
    raise exception 'not_signed_in';
  end if;
  if not public.qa_valid_name(p_name) then
    raise exception 'bad_name';
  end if;
  if exists (select 1 from public.qa_progress where nickname_key = lower(btrim(p_name)) and user_id <> v_id) then
    raise exception 'name_taken';
  end if;
  update public.qa_progress set nickname = btrim(p_name) where user_id = v_id;
  if not found then
    raise exception 'not_signed_in';
  end if;
  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
           || jsonb_build_object('display_name', btrim(p_name), 'nickname', btrim(p_name)),
         updated_at = now()
   where id = v_id;
  return json_build_object('name', btrim(p_name));
exception
  when unique_violation then raise exception 'name_taken';
end;
$$;

-- Перенос уже зарегистрированных магов: тот же пароль (bcrypt-хэш переносится как есть) и тот же прогресс.
do $$
declare
  r record;
begin
  if to_regclass('public.qa_players') is null then
    return; -- старая таблица уже удалена очисткой
  end if;
  for r in select * from public.qa_players p
           where not exists (select 1 from public.qa_progress g where g.nickname_key = p.name_key) loop
    perform public.qa_create_auth_user(r.id, r.name, r.pass_hash, r.created_at);
    insert into public.qa_progress (user_id, nickname, state, updated_at) values (r.id, r.name, r.state, r.updated_at);
  end loop;
end $$;

-- Старые функции входа через собственные сессии больше не доступны снаружи.
do $$
begin
  if to_regprocedure('public.qa_login(text, text)') is not null then
    revoke all on function public.qa_login(text, text), public.qa_load(text), public.qa_save(text, jsonb), public.qa_logout(text)
      from anon, authenticated;
  end if;
end $$;
revoke all on function public.qa_create_auth_user(uuid, text, text, timestamptz), public.qa_auth_email_for(uuid) from public, anon, authenticated;
revoke all on function public.qa_valid_name(text), public.qa_register(text, text), public.qa_login_email(text), public.qa_name_available(text) from public;
grant execute on function public.qa_valid_name(text), public.qa_register(text, text), public.qa_login_email(text), public.qa_name_available(text) to anon, authenticated;
revoke all on function public.qa_rename(text) from public, anon;
grant execute on function public.qa_rename(text) to authenticated;

-- Страховка: копия прежней версии прогресса перед изменением (не чаще раза в час на игрока).
-- Таблица закрыта RLS без политик: из браузера её не прочитать; восстановление — вручную из SQL Editor.
create table if not exists public.qa_progress_backup (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  state      jsonb not null,
  saved_at   timestamptz not null default now()
);
create index if not exists qa_progress_backup_user on public.qa_progress_backup (user_id, saved_at desc);
alter table public.qa_progress_backup enable row level security;
revoke all on public.qa_progress_backup from anon, authenticated;

create or replace function public.qa_progress_keep_backup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state is distinct from new.state and old.state <> '{}'::jsonb
     and not exists (select 1 from public.qa_progress_backup b where b.user_id = old.user_id and b.saved_at > now() - interval '1 hour') then
    insert into public.qa_progress_backup (user_id, state) values (old.user_id, old.state);
  end if;
  return new;
end;
$$;
revoke all on function public.qa_progress_keep_backup() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'qa_progress_keep_backup') then
    create trigger qa_progress_keep_backup before update of state on public.qa_progress
      for each row execute function public.qa_progress_keep_backup();
  end if;
end $$;
