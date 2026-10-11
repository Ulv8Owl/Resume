-- Разовая очистка проекта Supabase. Запусти в SQL Editor (Supabase → SQL Editor → Run).
-- Удаляет всё, что осталось от прежнего приложения (GameMind), и старую систему входа Академии
-- (qa_players / qa_sessions), которую заменили пользователи Supabase Auth и таблица qa_progress.
-- Не трогает: qa_progress, функции qa_register / qa_login_email / qa_name_available / qa_valid_name /
-- qa_create_auth_user / qa_auth_email_for, пользователей Auth и событийный триггер ensure_rls.
-- Скрипт можно запускать повторно.

begin;

-- 1. Прежнее приложение
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.accept_invitation(uuid, integer) cascade;
drop function if exists public.add_coins(integer) cascade;
drop function if exists public.add_wealth_copper(bigint) cascade;
drop function if exists public.buy_crystals(uuid, integer) cascade;
drop function if exists public.buy_palace(text, integer) cascade;
drop function if exists public.buy_style(uuid, text, integer) cascade;
drop function if exists public.buy_style(text, integer) cascade;
drop function if exists public.claim_crystals(integer) cascade;
drop function if exists public.claim_note_read(uuid, integer) cascade;
drop function if exists public.create_room(text, integer, integer, bigint) cascade;
drop function if exists public.expand_island_capacity(uuid, integer, integer) cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.is_username_available(text) cascade;
drop function if exists public.unlock_room(text, integer) cascade;
drop table if exists public.mp_room_objects, public.mp_rooms, public.mp_notes, public.mp_labels,
  public.mp_profiles, public.invitations, public.island_members, public.islands,
  public.game_saves, public.profiles cascade;

-- 2. Старая система входа Академии (маги уже перенесены в Supabase Auth)
drop function if exists public.qa_login(text, text);
drop function if exists public.qa_load(text);
drop function if exists public.qa_save(text, jsonb);
drop function if exists public.qa_logout(text);
drop function if exists public.qa_session_player(text);
drop function if exists public.qa_new_session(uuid);
drop table if exists public.qa_sessions, public.qa_players;

commit;

-- Проверка: в public должна остаться только таблица qa_progress
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';
