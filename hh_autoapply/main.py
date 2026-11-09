import os
import sys
import time
import random
import shutil
import threading
import queue
import struct
import subprocess
import tempfile
import wave
import requests
import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
from datetime import datetime

# Явный импорт: selenium грузит webdriver.Chrome лениво, и PyInstaller его не видит
from selenium.webdriver.chrome.webdriver import WebDriver as ChromeWebDriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.common.exceptions import NoSuchElementException, WebDriverException
from webdriver_manager.chrome import ChromeDriverManager
from webdriver_manager.core.os_manager import ChromeType

# ==========================================================
# ⚙️ КОНФИГУРАЦИЯ
# ==========================================================
# Служебные файлы лежат рядом с программой (рядом с бинарником после сборки)
if getattr(sys, "frozen", False):
    BASE_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(BASE_DIR)

APP_VERSION = "2.4-linux"
PROFILE_DIR = "chrome_profile"
LINKS_FILE = "vacancies_links.txt"
APPLIED_FILE = "applied_links.txt"          # отклик отправлен
NOT_APPLIED_FILE = "not_applied_links.txt"  # не откликнулись: ссылка<TAB>причина
KEYWORDS_FILE = "keywords.txt"
COVER_LETTER_FILE = "cover_letter.txt"
MODE_FILE = "captcha_mode.txt"

MAX_PAGES_PER_COUNTRY = 40
MAX_RESPONSES_PER_RUN = 200
SLEEP_BETWEEN_RESPONSES = 30
SLEEP_AFTER_ERRORS = 15
ERROR_LIMIT = 3
CAPTCHA_WAIT_MINUTES = 30      # сколько ждать, пока пользователь пройдёт капчу
CAPTCHA_RETRIES_PER_LINK = 3   # ручной режим: после стольких капч на одной вакансии она остаётся в «Осталось»
AUTO_CAPTCHA_STREAK = 3        # автономный режим: столько капч подряд -> перерыв
AUTO_CAPTCHA_COOLDOWN_MIN = 15 # длина перерыва; если после него снова серия капч — остановка
CAPTCHA_SOUND_REPEAT_SEC = 60  # ручной режим: повтор звука, пока капча не пройдена

MODE_MANUAL = "Ручной"
MODE_AUTO = "Автономный"

# Глобальные переменные для управления потоками
is_running = False
log_queue = queue.Queue()
ui_queue = queue.Queue()  # события из рабочих потоков -> главный поток Tk
auth_done_event = threading.Event()  # пользователь нажал «Я вошёл»
auth_waiting = False
stop_event = threading.Event()     # кнопка «Остановить»
captcha_event = threading.Event()  # кнопка «Капча пройдена»
captcha_mode = MODE_MANUAL         # меняется переключателем в окне, читается при капче
captcha_streak = 0                 # автономный режим: капч подряд
captcha_cooldowns = 0              # автономный режим: перерывов подряд


# ==========================================================
# 🛠️ УТИЛИТЫ (ФАЙЛЫ И ЛОГИ)
# ==========================================================
def log_message(msg):
    timestamp = datetime.now().strftime("%H:%M:%S")
    formatted = f"[{timestamp}] {msg}"
    log_queue.put(formatted)
    print(formatted, flush=True)  # Дублируем в консоль для отладки


def load_lines(path):
    if not os.path.exists(path):
        return set()
    with open(path, "r", encoding="utf-8") as f:
        # В строке может быть "ссылка<TAB>причина" — берём только ссылку
        return set(line.split("\t")[0].strip() for line in f if line.strip())


def save_line(path, line):
    with open(path, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def load_keywords():
    if not os.path.exists(KEYWORDS_FILE):
        default_kws = ["Python", "QA", "AQA"]
        save_keywords(default_kws)
        return default_kws
    with open(KEYWORDS_FILE, "r", encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip()]


def save_keywords(kw_list):
    with open(KEYWORDS_FILE, "w", encoding="utf-8") as f:
        for kw in kw_list:
            f.write(kw + "\n")


def load_cover_letter():
    if not os.path.exists(COVER_LETTER_FILE):
        default_cl = "Здравствуйте! Ознакомился с вашей вакансией — мой опыт полностью соответствует указанным требованиям и технологиям. Буду рад обсудить подробнее. Подскажите, когда будет удобно созвониться?"
        save_cover_letter(default_cl)
        return default_cl
    with open(COVER_LETTER_FILE, "r", encoding="utf-8") as f:
        return f.read()


def load_mode():
    try:
        with open(MODE_FILE, "r", encoding="utf-8") as f:
            mode = f.read().strip()
        return mode if mode in (MODE_MANUAL, MODE_AUTO) else MODE_MANUAL
    except OSError:
        return MODE_MANUAL


def save_mode(mode):
    with open(MODE_FILE, "w", encoding="utf-8") as f:
        f.write(mode)


def save_cover_letter(text):
    with open(COVER_LETTER_FILE, "w", encoding="utf-8") as f:
        f.write(text)


# ==========================================================
# 🌐 SELENIUM ДРАЙВЕР
# ==========================================================
def get_driver():
    options = Options()
    options.add_argument("--start-maximized")
    options.add_argument(f"--user-data-dir={os.path.abspath(PROFILE_DIR)}")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option('useAutomationExtension', False)
    options.add_argument("--disable-blink-features=AutomationControlled")

    # Linux: Google Chrome или Chromium из репозитория Debian
    chrome_type = ChromeType.GOOGLE
    if not (shutil.which("google-chrome") or shutil.which("google-chrome-stable")):
        chromium = shutil.which("chromium") or shutil.which("chromium-browser")
        if chromium:
            options.binary_location = chromium
            chrome_type = ChromeType.CHROMIUM

    # 1) системный драйвер (apt install chromium-driver)
    system_driver = shutil.which("chromedriver")
    if system_driver:
        try:
            return ChromeWebDriver(service=Service(system_driver), options=options)
        except WebDriverException as e:
            log_message(f"⚠️ Системный chromedriver не подошёл: {e.msg}")
    # 2) webdriver-manager
    try:
        return ChromeWebDriver(service=Service(ChromeDriverManager(chrome_type=chrome_type).install()), options=options)
    except Exception as e:
        log_message(f"⚠️ webdriver-manager: {e}. Пробуем Selenium Manager...")
    # 3) встроенный Selenium Manager
    return ChromeWebDriver(options=options)


def is_logged_in(driver):
    """True — вошёл, False — не вошёл, None — определить не удалось."""
    # hh.ru ставит cookie hhrole: "anonymous" для гостя, иначе роль пользователя
    role = driver.get_cookie("hhrole")
    if role and role.get("value"):
        return role["value"] != "anonymous"
    if driver.find_elements(By.CSS_SELECTOR, '[data-qa="login"]'):
        return False  # Кнопка "Войти" есть = не авторизован
    return None


def check_auth(driver):
    driver.get("https://hh.ru/")
    time.sleep(random.uniform(2.0, 4.0))
    return is_logged_in(driver) is not False


# ==========================================================
# 🧠 БИЗНЕС-ЛОГИКА (ПОТОКИ)
# ==========================================================
def task_authorize(ui_callback):
    global is_running, auth_waiting
    if is_running: return
    is_running = True
    ui_callback("auth_start")
    driver = None

    try:
        driver = get_driver()
        driver.get("https://hh.ru/account/login")
        log_message("🌐 Браузер открыт. Войдите в hh.ru в ЭТОМ окне, затем нажмите «✅ Я вошёл».")

        deadline = time.time() + 15 * 60
        while True:
            auth_done_event.clear()
            auth_waiting = True
            ui_callback("auth_wait")
            # Ждём нажатия кнопки, страницу не трогаем, пока пользователь вводит данные
            while not auth_done_event.wait(2):
                if time.time() > deadline:
                    raise TimeoutError("Не дождались входа (15 минут). Попробуйте ещё раз.")
                try:
                    driver.window_handles
                except WebDriverException:
                    raise RuntimeError("Окно браузера закрыто до завершения входа.")
            auth_waiting = False
            ui_callback("auth_checking")

            driver.get("https://hh.ru/")
            time.sleep(random.uniform(2.0, 4.0))
            state = is_logged_in(driver)
            if state is False:
                log_message("⚠️ hh.ru показывает, что вход не выполнен. Войдите и снова нажмите «Я вошёл».")
                ui_callback("auth_not_yet")
                driver.get("https://hh.ru/account/login")
                continue
            if state is None:
                log_message("ℹ️ Не удалось однозначно проверить вход — считаем, что вы вошли.")
            log_message("✅ Авторизация сохранена в профиле программы.")
            ui_callback("auth_success")
            break
    except Exception as e:
        err = getattr(e, "msg", None) or str(e)
        log_message(f"❌ Ошибка авторизации: {err}")
        ui_callback("auth_error", err)
    finally:
        auth_waiting = False
        is_running = False
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
        ui_callback("auth_finish")


def task_reset_auth(ui_callback):
    global is_running
    if is_running:
        log_message("⚠️ Дождитесь завершения текущей операции.")
        return

    if os.path.exists(PROFILE_DIR):
        try:
            shutil.rmtree(PROFILE_DIR)
            log_message("🗑️ Профиль браузера удален. Авторизация сброшена.")
            ui_callback("auth_reset")
        except Exception as e:
            log_message(f"❌ Ошибка удаления профиля (закройте браузер): {e}")
    else:
        log_message("ℹ️ Профиль не найден, сброс не требуется.")
        ui_callback("auth_reset")


# ==========================================================
# 🧩 РАБОТА СО СТРАНИЦЕЙ HH.RU
# ==========================================================
NBSP = " "


def visible(driver, by, sel):
    try:
        return [e for e in driver.find_elements(by, sel) if e.is_displayed()]
    except WebDriverException:
        return []


def visible_text(driver, *phrases):
    """Видимые элементы, в тексте которых есть одна из фраз (неразрывные пробелы учитываются)."""
    conds = " or ".join(f"contains(translate(text(), '{NBSP}', ' '), '{p}')" for p in phrases)
    return visible(driver, By.XPATH, f"//*[{conds}]")


def click(driver, el):
    try:
        el.click()
    except WebDriverException:
        driver.execute_script("arguments[0].click();", el)


def has_captcha(driver):
    return bool(visible_text(driver, "Пройдите капчу", "текст с картинки")
                or visible(driver, By.CSS_SELECTOR, '[data-qa*="captcha"], img[src*="captcha"]'))


def already_applied(driver):
    return bool(visible_text(driver, "Вы откликнулись", "Резюме доставлено", "Отклик отправлен"))


def wait_for_captcha(ui_callback):
    """Ручной режим: пауза, пока пользователь сам проходит капчу в браузере. False — если остановили."""
    captcha_event.clear()
    ui_callback("captcha")
    log_message("🧩 Капча! Пройдите её в окне браузера и нажмите «▶ Капча пройдена — продолжить».")
    try:
        if not captcha_event.wait(CAPTCHA_WAIT_MINUTES * 60):
            log_message(f"⏰ Капча не пройдена за {CAPTCHA_WAIT_MINUTES} мин. Останавливаемся.")
            stop_event.set()
    finally:
        ui_callback("captcha_done")
    return not stop_event.is_set()


def reset_captcha_streak():
    global captcha_streak, captcha_cooldowns
    captcha_streak = 0
    captcha_cooldowns = 0


def handle_captcha(ui_callback):
    """Что делать при капче: "retry" — повторить, "skip" — пропустить, "stop" — остановиться."""
    global captcha_streak, captcha_cooldowns
    if captcha_mode == MODE_MANUAL:
        return "retry" if wait_for_captcha(ui_callback) else "stop"

    captcha_streak += 1
    log_message(f"🧩 Капча — пропускаем (автономный режим, подряд: {captcha_streak}).")
    if captcha_streak >= AUTO_CAPTCHA_STREAK:
        if captcha_cooldowns >= 1:
            log_message("⛔ Капчи идут подряд и после перерыва — останавливаемся, чтобы не рисковать аккаунтом.")
            stop_event.set()
            return "stop"
        captcha_cooldowns += 1
        captcha_streak = 0
        log_message(f"☕ {AUTO_CAPTCHA_STREAK} капчи подряд — перерыв {AUTO_CAPTCHA_COOLDOWN_MIN} мин.")
        if stop_event.wait(AUTO_CAPTCHA_COOLDOWN_MIN * 60):
            return "stop"
    return "skip"


def attach_cover_letter(driver, cover_letter):
    """После отклика: «Приложить сопроводительное письмо», если такая кнопка есть."""
    btns = visible_text(driver, "Приложить сопроводительное")
    if not btns:
        return None
    try:
        click(driver, btns[0])
        time.sleep(random.uniform(1.0, 2.0))
        if visible_text(driver, "уже прочитал"):
            return "работодатель уже прочитал отклик — письмо не приложить"
        areas = visible(driver, By.CSS_SELECTOR, "textarea")
        if not areas:
            return "поле для письма не появилось"
        areas[0].clear()
        areas[0].send_keys(cover_letter)
        time.sleep(random.uniform(1.0, 2.0))
        submit = (visible(driver, By.CSS_SELECTOR, '[data-qa="vacancy-response-letter-submit"]')
                  or visible(driver, By.XPATH, "//button[contains(., 'Отправить')]"))
        if not submit:
            return "кнопка «Отправить» для письма не найдена"
        click(driver, submit[0])
        time.sleep(random.uniform(1.5, 2.5))
        if visible_text(driver, "уже прочитал"):
            return "работодатель уже прочитал отклик — письмо не приложить"
        return "приложено"
    except WebDriverException as e:
        return f"ошибка: {e.msg}"


def apply_one(driver, link, cover_letter):
    """Возвращает (статус, пояснение): applied / already / not_applied / captcha."""
    driver.get(link)
    time.sleep(random.uniform(2.0, 4.0))
    if has_captcha(driver):
        return "captcha", ""
    if already_applied(driver):
        return "already", ""

    btns = visible(driver, By.CSS_SELECTOR, '[data-qa="vacancy-response-link-top"]')
    if not btns:
        return "not_applied", "нет кнопки «Откликнуться» (отклик на сайте компании?)"
    click(driver, btns[0])
    time.sleep(random.uniform(1.5, 3.0))
    if has_captcha(driver):
        return "captcha", ""

    for el in visible(driver, By.CSS_SELECTOR, '[data-qa="relocation-warning-confirm"]'):
        click(driver, el)
        time.sleep(random.uniform(1.0, 2.0))
    if has_captcha(driver):
        return "captcha", ""

    if "vacancy_response" in driver.current_url and not already_applied(driver):
        return "not_applied", "работодатель просит ответить на вопросы / пройти тест"

    # Всплывающее окно отклика: вставляем письмо и отправляем
    submit = visible(driver, By.CSS_SELECTOR, '[data-qa="vacancy-response-submit-popup"]')
    if submit:
        areas = visible(driver, By.CSS_SELECTOR, "textarea")
        if not areas:
            for t in visible(driver, By.CSS_SELECTOR, '[data-qa="vacancy-response-letter-toggle"]'):
                click(driver, t)
                time.sleep(1)
            areas = visible(driver, By.CSS_SELECTOR, "textarea")
        if len(areas) > 1 or visible(driver, By.CSS_SELECTOR, '[role="dialog"] input[type="radio"], [role="dialog"] input[type="checkbox"]'):
            return "not_applied", "в форме отклика есть вопросы работодателя"
        if areas:
            areas[0].clear()
            areas[0].send_keys(cover_letter)
            time.sleep(random.uniform(1.0, 2.0))
        click(driver, submit[0])
        time.sleep(random.uniform(2.0, 3.0))
        if has_captcha(driver):
            return "captcha", ""
        if visible(driver, By.CSS_SELECTOR, '[data-qa="vacancy-response-submit-popup"]'):
            return "not_applied", "форма отклика не отправилась (обязательные поля?)"
        if areas:
            return "applied", "с письмом"
        letter = attach_cover_letter(driver, cover_letter)
        return "applied", f"письмо: {letter}" if letter else "без письма"

    # Отклик ушёл сразу, без окна — пробуем приложить письмо
    time.sleep(1)
    if already_applied(driver) or visible_text(driver, "Приложить сопроводительное"):
        letter = attach_cover_letter(driver, cover_letter)
        return "applied", f"письмо: {letter}" if letter else "без письма"
    return "not_applied", "неизвестная форма отклика"


# ==========================================================
# 🧠 ПОИСК И ОТКЛИКИ
# ==========================================================
def task_search(keywords, country_mode, ui_callback):
    global is_running
    if is_running: return
    is_running = True
    stop_event.clear()
    reset_captcha_streak()
    ui_callback("search_start")
    driver = None
    current_run_links = set()
    existing_links = load_lines(LINKS_FILE)

    def save_new(after):
        nonlocal existing_links
        new_to_save = current_run_links - existing_links
        if new_to_save:
            with open(LINKS_FILE, "a", encoding="utf-8") as f:
                for link in new_to_save:
                    f.write(link + "\n")
            existing_links |= new_to_save
            log_message(f"💾 Сохранено {len(new_to_save)} новых ссылок {after}")

    try:
        driver = get_driver()
        if not check_auth(driver):
            log_message("⚠️ Сначала выполните авторизацию!")
            ui_callback("search_error", "Требуется авторизация")
            return

        known = load_lines(APPLIED_FILE) | load_lines(NOT_APPLIED_FILE)

        # 1. Получаем страны
        log_message("🌍 Загрузка списка стран из API hh.ru...")
        resp = requests.get("https://api.hh.ru/areas", timeout=15, headers={'User-Agent': 'Mozilla/5.0'})
        all_countries = [{"id": c["id"], "name": c["name"]} for c in resp.json()]

        # 2. Фильтруем страны
        if country_mode == "Кроме РФ и РБ":
            countries = [c for c in all_countries if c["id"] not in ("113", "16")]
        elif country_mode == "Только РФ и РБ":
            countries = [c for c in all_countries if c["id"] in ("113", "16")]
        else:
            countries = all_countries

        log_message(f"✅ Выбрано стран для поиска: {len(countries)}")

        # 3. Поиск
        for kw_idx, keyword in enumerate(keywords, 1):
            if stop_event.is_set(): break
            log_message(f"🔎 Ключевое слово: «{keyword}» ({kw_idx}/{len(keywords)})")

            for c_idx, country in enumerate(countries, 1):
                if stop_event.is_set(): break
                log_message(f"🚀 [{c_idx}/{len(countries)}] Страна: {country['name']}")

                page = 0
                while page < MAX_PAGES_PER_COUNTRY and not stop_event.is_set():
                    url = f"https://hh.ru/search/vacancy?text={keyword}&search_field=name&area={country['id']}&order_by=relevance&items_on_page=50"
                    if page > 0: url += f"&page={page}"

                    driver.get(url)
                    time.sleep(random.uniform(2.0, 4.0))
                    if has_captcha(driver):
                        action = handle_captcha(ui_callback)
                        if action == "retry":
                            continue  # та же страница ещё раз
                        break  # skip — следующая страна, stop — выходим по stop_event
                    reset_captcha_streak()

                    # Скролл
                    last_height = driver.execute_script("return document.body.scrollHeight")
                    while not stop_event.is_set():
                        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                        time.sleep(1.5)
                        new_height = driver.execute_script("return document.body.scrollHeight")
                        if new_height == last_height: break
                        last_height = new_height

                    # Парсинг
                    cards = driver.find_elements(By.CSS_SELECTOR, 'a[data-qa="serp-item__title"]')
                    new_found = 0
                    for card in cards:
                        link = card.get_attribute("href")
                        if link and link not in known and link not in existing_links and link not in current_run_links:
                            current_run_links.add(link)
                            new_found += 1

                    log_message(f"   стр. {page + 1}: новых {new_found} (всего в памяти: {len(current_run_links)})")
                    if new_found == 0: break
                    page += 1
                    if stop_event.wait(random.uniform(1.0, 2.0)): break

            # Сохранение после каждого ключевого слова
            save_new(f"после «{keyword}»")

        total = len(existing_links | current_run_links)
        if stop_event.is_set():
            log_message(f"⏹ Поиск остановлен. Всего в базе: {total}")
            ui_callback("stopped", f"Поиск остановлен. Всего в базе: {total} вакансий.")
        else:
            log_message(f"🏁 Поиск завершен! Всего собрано: {total}")
            ui_callback("search_finish", total)

    except Exception as e:
        log_message(f"❌ Ошибка поиска: {e}")
        ui_callback("search_error", str(e))
    finally:
        try:
            save_new("(при остановке)")
        except Exception:
            pass
        is_running = False
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
        ui_callback("cleanup")


def task_apply(cover_letter, ui_callback):
    global is_running
    if is_running: return
    is_running = True
    stop_event.clear()
    reset_captcha_streak()
    ui_callback("apply_start")
    driver = None

    try:
        all_links = list(load_lines(LINKS_FILE))
        applied_links = load_lines(APPLIED_FILE)
        not_applied_links = load_lines(NOT_APPLIED_FILE)
        links_to_process = [l for l in all_links if l not in applied_links and l not in not_applied_links]

        log_message(f"🔗 К обработке: {len(links_to_process)} (откликнуто: {len(applied_links)}, не откликнуто: {len(not_applied_links)})")

        if not all_links:
            log_message("ℹ️ Список вакансий пуст — сначала запустите поиск вакансий.")
            ui_callback("apply_error", "Список вакансий пуст.\nСначала нажмите «🚀 Запустить поиск вакансий».")
            return
        if not links_to_process:
            log_message("✅ Все собранные вакансии уже обработаны!")
            ui_callback("apply_finish", (0, 0))
            return

        driver = get_driver()
        if not check_auth(driver):
            log_message("⚠️ Сначала выполните авторизацию!")
            ui_callback("apply_error", "Требуется авторизация")
            return

        error_count = 0
        responses_sent = 0
        skipped = 0
        captcha_tries = {}
        i = 0

        while i < len(links_to_process):
            if stop_event.is_set():
                break
            if responses_sent >= MAX_RESPONSES_PER_RUN:
                log_message(f"🏁 Достигнут лимит в {MAX_RESPONSES_PER_RUN} откликов.")
                break

            link = links_to_process[i]
            log_message(f"🔍 {i + 1}/{len(links_to_process)} — {link}")
            try:
                status, note = apply_one(driver, link, cover_letter)
                error_count = 0
            except WebDriverException as e:
                log_message(f"🚫 Ошибка WebDriver: {e.msg}")
                if "invalid session" in str(e) or "no such window" in str(e):
                    raise RuntimeError("Окно браузера закрыто.")
                error_count += 1
                if error_count >= ERROR_LIMIT:
                    log_message(f"⛔ Лимит ошибок. Пауза {SLEEP_AFTER_ERRORS} сек...")
                    stop_event.wait(SLEEP_AFTER_ERRORS)
                    error_count = 0
                i += 1
                continue

            if status == "captcha":
                captcha_tries[link] = captcha_tries.get(link, 0) + 1
                if captcha_mode == MODE_MANUAL and captcha_tries[link] > CAPTCHA_RETRIES_PER_LINK:
                    log_message("⏭ Капча повторяется — вакансия остаётся в «Осталось», идём дальше.")
                    i += 1
                    continue
                action = handle_captcha(ui_callback)
                if action == "stop":
                    break
                if action == "skip":
                    i += 1  # вакансия не помечается и остаётся в «Осталось»
                    continue
                log_message("🔁 Повторяем отклик на эту же вакансию...")
                continue  # i не увеличиваем — та же вакансия сразу ещё раз

            reset_captcha_streak()
            i += 1
            if status == "already":
                log_message("✅ Уже откликнулись ранее (статус на странице).")
                save_line(APPLIED_FILE, link)
                continue
            if status == "not_applied":
                log_message(f"🚫 Не откликнулись: {note}")
                save_line(NOT_APPLIED_FILE, f"{link}\t{note}")
                skipped += 1
                stop_event.wait(random.uniform(3.0, 6.0))
                continue

            log_message(f"✅ Отклик отправлен ({note})")
            save_line(APPLIED_FILE, link)
            responses_sent += 1
            if responses_sent >= MAX_RESPONSES_PER_RUN or i >= len(links_to_process):
                continue
            log_message(f"💤 Пауза {SLEEP_BETWEEN_RESPONSES} сек...")
            stop_event.wait(SLEEP_BETWEEN_RESPONSES)

        if stop_event.is_set():
            log_message(f"⏹ Остановлено. Отправлено: {responses_sent}, не откликнулись: {skipped}.")
            ui_callback("stopped", f"Отклики остановлены.\nОтправлено: {responses_sent}\nНе откликнулись: {skipped}")
        else:
            log_message(f"🏁 Готово. Отправлено: {responses_sent}, не откликнулись: {skipped}.")
            ui_callback("apply_finish", (responses_sent, skipped))

    except Exception as e:
        log_message(f"❌ Ошибка откликов: {e}")
        ui_callback("apply_error", str(e))
    finally:
        is_running = False
        if driver:
            try:
                driver.quit()
            except Exception:
                pass
        ui_callback("cleanup")


# ==========================================================
# 🔔 УВЕДОМЛЕНИЕ И ЗВУК ПРИ КАПЧЕ
# ==========================================================
def system_env():
    """Окружение для системных программ: PyInstaller подменяет LD_LIBRARY_PATH своими библиотеками."""
    env = dict(os.environ)
    if getattr(sys, "frozen", False):
        orig = env.get("LD_LIBRARY_PATH_ORIG")
        if orig:
            env["LD_LIBRARY_PATH"] = orig
        else:
            env.pop("LD_LIBRARY_PATH", None)
    return env


def run_detached(cmd):
    try:
        subprocess.Popen(cmd, env=system_env(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except OSError:
        return False


_alarm_path = None


def alarm_file():
    """Громкий сигнал тревоги (WAV), создаётся один раз."""
    global _alarm_path
    if _alarm_path and os.path.exists(_alarm_path):
        return _alarm_path
    rate = 44100
    frames = bytearray()
    for _ in range(4):
        for freq in (1000, 1500):
            for n in range(int(rate * 0.18)):
                # меандр на полной громкости — слышно даже на тихих колонках
                val = 32000 if (n * freq * 2 // rate) % 2 == 0 else -32000
                frames += struct.pack("<h", val)
        frames += b"\x00\x00" * int(rate * 0.08)
    path = os.path.join(tempfile.gettempdir(), "hhautoapply_alarm.wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    _alarm_path = path
    return path


def play_alarm():
    path = alarm_file()
    for player in ("pw-play", "paplay", "aplay"):
        if shutil.which(player):
            if run_detached([player, path]):
                return True
    return False


def desktop_notify(text):
    if not shutil.which("notify-send"):
        return False
    try:
        r = subprocess.run(["notify-send", "-u", "critical", "-a", "HHAutoApply", text],
                           env=system_env(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3)
        return r.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


# ==========================================================
# 🖥️ GRAPHICAL USER INTERFACE (TKINTER)
# ==========================================================
class AppUI:
    def __init__(self, root):
        self.root = root
        self.root.title(f"HH.ru Automation Tool v{APP_VERSION}")
        # Высота под экран, чтобы «Журнал событий» не обрезался
        height = min(900, self.root.winfo_screenheight() - 80)
        self.root.geometry(f"850x{height}")
        self.root.minsize(800, 550)

        self.build_ui()
        self.update_stats()

        # Запускаем периодическое обновление логов и статистики
        self.root.after(100, self.poll_logs)
        self.root.after(5000, self.poll_stats)

    def build_ui(self):
        # --- 1. Авторизация ---
        frame_auth = ttk.LabelFrame(self.root, text="Управление сессией", padding=10)
        frame_auth.pack(fill=tk.X, padx=10, pady=5)

        self.btn_auth = ttk.Button(frame_auth, text="🔑 Авторизоваться", command=self.on_auth)
        self.btn_auth.pack(side=tk.LEFT, padx=5)

        self.btn_reset = ttk.Button(frame_auth, text="🗑️ Сбросить авторизацию", command=self.on_reset_auth)
        self.btn_reset.pack(side=tk.LEFT, padx=5)

        self.btn_stop = ttk.Button(frame_auth, text="⏹ Остановить", command=self.on_stop, state=tk.DISABLED)
        self.btn_stop.pack(side=tk.LEFT, padx=5)

        self.lbl_auth_status = tk.Label(frame_auth, text="Статус: Не проверено", font=("Arial", 10, "bold"), fg="gray")
        self.lbl_auth_status.pack(side=tk.RIGHT, padx=5)

        # --- 2. Настройки поиска ---
        frame_search = ttk.LabelFrame(self.root, text="Настройки поиска", padding=10)
        frame_search.pack(fill=tk.X, padx=10, pady=5)

        # Ключевые слова
        frame_kw = ttk.Frame(frame_search)
        frame_kw.pack(fill=tk.X, pady=5)
        ttk.Label(frame_kw, text="Ключевые слова:").pack(side=tk.LEFT)

        self.entry_kw = ttk.Entry(frame_kw, width=20)
        self.entry_kw.pack(side=tk.LEFT, padx=5)
        self.entry_kw.bind("<Return>", lambda e: self.add_keyword())

        ttk.Button(frame_kw, text="Добавить", command=self.add_keyword).pack(side=tk.LEFT, padx=2)
        ttk.Button(frame_kw, text="Удалить", command=self.remove_keyword).pack(side=tk.LEFT, padx=2)

        self.listbox_kw = tk.Listbox(frame_search, height=4, font=("Consolas", 10))
        self.listbox_kw.pack(fill=tk.X, pady=5)
        for kw in load_keywords():
            self.listbox_kw.insert(tk.END, kw)

        # Выбор стран
        frame_country = ttk.Frame(frame_search)
        frame_country.pack(fill=tk.X, pady=5)
        ttk.Label(frame_country, text="Регион поиска:").pack(side=tk.LEFT)

        self.country_var = tk.StringVar(value="Кроме РФ и РБ")
        country_cb = ttk.Combobox(frame_country, textvariable=self.country_var, state="readonly", width=25)
        country_cb['values'] = ("Кроме РФ и РБ", "Только РФ и РБ", "Все страны")
        country_cb.pack(side=tk.LEFT, padx=5)

        self.btn_search = ttk.Button(frame_search, text="🚀 Запустить поиск вакансий", command=self.on_search)
        self.btn_search.pack(fill=tk.X, pady=10)

        # --- 3. Автоотклики ---
        frame_apply = ttk.LabelFrame(self.root, text="Автоотклики", padding=10)
        frame_apply.pack(fill=tk.X, padx=10, pady=5)

        ttk.Label(frame_apply, text=f"Лимит откликов за запуск: {MAX_RESPONSES_PER_RUN} шт.").pack(anchor=tk.W)

        # Поле для редактирования сопроводительного письма
        ttk.Label(frame_apply, text="Сопроводительное письмо:").pack(anchor=tk.W, pady=(5, 0))
        self.text_cover_letter = scrolledtext.ScrolledText(frame_apply, height=4, font=("Arial", 10))
        self.text_cover_letter.pack(fill=tk.X, pady=5)
        self.text_cover_letter.insert(tk.END, load_cover_letter())

        frame_mode = ttk.Frame(frame_apply)
        frame_mode.pack(fill=tk.X, pady=(0, 5))
        ttk.Label(frame_mode, text="Режим при капче:").pack(side=tk.LEFT)
        self.mode_var = tk.StringVar(value=load_mode())
        ttk.Radiobutton(frame_mode, text="Ручной — уведомление и звук", value=MODE_MANUAL,
                        variable=self.mode_var, command=self.on_mode).pack(side=tk.LEFT, padx=5)
        ttk.Radiobutton(frame_mode, text="Автономный — пропускать капчи", value=MODE_AUTO,
                        variable=self.mode_var, command=self.on_mode).pack(side=tk.LEFT, padx=5)
        self.on_mode()
        self.captcha_alarm_on = False
        self.captcha_popup = None

        self.btn_apply = ttk.Button(frame_apply, text="💼 Запустить автоотклики", command=self.on_apply)
        self.btn_apply.pack(fill=tk.X, pady=5)

        self.btn_captcha = ttk.Button(frame_apply, text="▶ Капча пройдена — продолжить", command=self.on_captcha_done, state=tk.DISABLED)
        self.btn_captcha.pack(fill=tk.X, pady=(0, 5))

        # --- 4. Статистика ---
        frame_stats = ttk.LabelFrame(self.root, text="Статистика", padding=10)
        frame_stats.pack(fill=tk.X, padx=10, pady=5)

        stats_grid = ttk.Frame(frame_stats)
        stats_grid.pack(fill=tk.X)

        self.lbl_stat_total = tk.Label(stats_grid, text="📂 Всего собрано: 0", font=("Arial", 11, "bold"), fg="blue")
        self.lbl_stat_total.grid(row=0, column=0, padx=20, pady=5, sticky=tk.W)

        self.lbl_stat_applied = tk.Label(stats_grid, text="✅ Откликнуто: 0", font=("Arial", 11, "bold"), fg="green")
        self.lbl_stat_applied.grid(row=0, column=1, padx=20, pady=5, sticky=tk.W)

        self.lbl_stat_not_applied = tk.Label(stats_grid, text="🚫 Не откликнуто: 0", font=("Arial", 11, "bold"), fg="red")
        self.lbl_stat_not_applied.grid(row=0, column=2, padx=20, pady=5, sticky=tk.W)

        self.lbl_stat_pending = tk.Label(stats_grid, text="⏳ Осталось: 0", font=("Arial", 11, "bold"), fg="orange")
        self.lbl_stat_pending.grid(row=0, column=3, padx=20, pady=5, sticky=tk.W)

        self.lbl_captcha = tk.Label(frame_stats, text="", font=("Arial", 11, "bold"), fg="red")
        self.lbl_captcha.pack(anchor=tk.W)

        # --- 5. Логи ---
        frame_log = ttk.LabelFrame(self.root, text="Журнал событий", padding=10)
        frame_log.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)

        # Уменьшена высота поля логов для общей компактности окна
        self.text_log = scrolledtext.ScrolledText(frame_log, height=8, font=("Consolas", 9), state=tk.DISABLED)
        self.text_log.pack(fill=tk.BOTH, expand=True)

    def poll_logs(self):
        try:
            while True:
                msg = log_queue.get_nowait()
                self.text_log.config(state=tk.NORMAL)
                self.text_log.insert(tk.END, msg + "\n")
                self.text_log.see(tk.END)
                self.text_log.config(state=tk.DISABLED)
        except queue.Empty:
            pass
        try:
            while True:
                event, data = ui_queue.get_nowait()
                self.handle_callback(event, data)
        except queue.Empty:
            pass
        self.root.after(100, self.poll_logs)

    def poll_stats(self):
        self.update_stats()
        self.root.after(5000, self.poll_stats)  # Обновляем каждые 5 сек

    def update_stats(self):
        all_links = load_lines(LINKS_FILE)
        applied_links = load_lines(APPLIED_FILE)
        not_applied_links = load_lines(NOT_APPLIED_FILE) - applied_links
        pending = all_links - applied_links - not_applied_links

        self.lbl_stat_total.config(text=f"📂 Всего собрано: {len(all_links)}")
        self.lbl_stat_applied.config(text=f"✅ Откликнуто: {len(applied_links)}")
        self.lbl_stat_not_applied.config(text=f"🚫 Не откликнуто: {len(not_applied_links)}")
        self.lbl_stat_pending.config(text=f"⏳ Осталось: {len(pending)}")

    def set_auth_status(self, text, color):
        self.lbl_auth_status.config(text=f"Статус: {text}", fg=color)

    def handle_callback(self, event, data=None):
        if event == "auth_start":
            self.btn_auth.config(state=tk.DISABLED)
            self.btn_reset.config(state=tk.DISABLED)
            self.set_auth_status("Открываем браузер...", "orange")
        elif event == "auth_wait":
            self.btn_auth.config(text="✅ Я вошёл", state=tk.NORMAL)
            self.set_auth_status("Войдите в окне браузера и нажмите «Я вошёл»", "orange")
        elif event == "auth_checking":
            self.btn_auth.config(state=tk.DISABLED)
            self.set_auth_status("Проверяем вход...", "orange")
        elif event == "auth_not_yet":
            self.set_auth_status("Вход не выполнен — войдите и нажмите «Я вошёл»", "red")
        elif event == "auth_success":
            self.set_auth_status("Авторизован ✅", "green")
        elif event == "auth_error":
            self.set_auth_status("Ошибка авторизации ❌ (см. журнал)", "red")
        elif event == "auth_finish":
            self.btn_auth.config(text="🔑 Авторизоваться", state=tk.NORMAL)
            self.btn_reset.config(state=tk.NORMAL)
        elif event == "auth_reset":
            self.set_auth_status("Не авторизован (сброшено)", "red")

        elif event in ("search_start", "apply_start"):
            self.btn_search.config(state=tk.DISABLED)
            self.btn_apply.config(state=tk.DISABLED)
            self.btn_auth.config(state=tk.DISABLED)
            self.btn_reset.config(state=tk.DISABLED)
            self.btn_stop.config(state=tk.NORMAL)
        elif event == "captcha":
            self.btn_captcha.config(state=tk.NORMAL)
            self.lbl_captcha.config(text="КАПЧА")
            self.start_captcha_alarm()
        elif event == "captcha_done":
            self.btn_captcha.config(state=tk.DISABLED)
            self.lbl_captcha.config(text="")
            self.stop_captcha_alarm()
        elif event == "cleanup":
            self.btn_search.config(state=tk.NORMAL)
            self.btn_apply.config(state=tk.NORMAL)
            self.btn_auth.config(state=tk.NORMAL)
            self.btn_reset.config(state=tk.NORMAL)
            self.btn_stop.config(state=tk.DISABLED, text="⏹ Остановить")
            self.btn_captcha.config(state=tk.DISABLED)
            self.lbl_captcha.config(text="")
            self.stop_captcha_alarm()
            self.update_stats()

    # --- Капча: уведомление «КАПЧА» + громкий звук, повтор звука до прохождения ---
    def start_captcha_alarm(self):
        self.captcha_alarm_on = True
        if not desktop_notify("КАПЧА"):
            self.show_captcha_popup()  # нет notify-send — своё окно поверх всех
        self.captcha_beep()

    def captcha_beep(self):
        if not self.captcha_alarm_on:
            return
        if not play_alarm():
            for k in range(5):
                self.root.after(k * 300, self.root.bell)
        self.root.after(CAPTCHA_SOUND_REPEAT_SEC * 1000, self.captcha_beep)

    def stop_captcha_alarm(self):
        self.captcha_alarm_on = False
        if self.captcha_popup is not None:
            self.captcha_popup.destroy()
            self.captcha_popup = None

    def show_captcha_popup(self):
        if self.captcha_popup is not None:
            return
        win = tk.Toplevel(self.root)
        win.title("КАПЧА")
        win.attributes("-topmost", True)
        tk.Label(win, text="КАПЧА", font=("Arial", 48, "bold"), fg="white", bg="red",
                 padx=40, pady=20).pack()
        win.bind("<Button-1>", lambda e: self.stop_captcha_popup_only())
        win.protocol("WM_DELETE_WINDOW", self.stop_captcha_popup_only)
        self.captcha_popup = win

    def stop_captcha_popup_only(self):
        if self.captcha_popup is not None:
            self.captcha_popup.destroy()
            self.captcha_popup = None

    def on_mode(self):
        global captcha_mode
        captcha_mode = self.mode_var.get()
        save_mode(captcha_mode)

    def post_callback(self, event, data=None):
        # Tk нельзя трогать из рабочих потоков — передаём событие в главный поток
        ui_queue.put((event, data))

    # --- Обработчики кнопок ---
    def on_auth(self):
        if auth_waiting:
            auth_done_event.set()  # кнопка в режиме «Я вошёл»
            return
        threading.Thread(target=task_authorize, args=(self.post_callback,), daemon=True).start()

    def on_stop(self):
        log_message("⏹ Останавливаем после текущего шага...")
        self.btn_stop.config(state=tk.DISABLED, text="⏹ Останавливаем...")
        stop_event.set()
        captcha_event.set()  # снимаем ожидание капчи

    def on_captcha_done(self):
        captcha_event.set()

    def on_reset_auth(self):
        threading.Thread(target=task_reset_auth, args=(self.post_callback,), daemon=True).start()

    def add_keyword(self):
        kw = self.entry_kw.get().strip()
        if kw and kw not in self.listbox_kw.get(0, tk.END):
            self.listbox_kw.insert(tk.END, kw)
            self.entry_kw.delete(0, tk.END)
            save_keywords(list(self.listbox_kw.get(0, tk.END)))

    def remove_keyword(self):
        sel = self.listbox_kw.curselection()
        if sel:
            self.listbox_kw.delete(sel)
            save_keywords(list(self.listbox_kw.get(0, tk.END)))

    def on_search(self):
        kws = list(self.listbox_kw.get(0, tk.END))
        if not kws:
            log_message("⚠️ Добавьте хотя бы одно ключевое слово.")
            return

        country_mode = self.country_var.get()
        threading.Thread(target=task_search, args=(kws, country_mode, self.post_callback), daemon=True).start()

    def on_apply(self):
        # Получаем актуальный текст письма, сохраняем его и передаем в поток
        cover_letter_text = self.text_cover_letter.get("1.0", tk.END).strip()
        save_cover_letter(cover_letter_text)
        threading.Thread(target=task_apply, args=(cover_letter_text, self.post_callback), daemon=True).start()


# ==========================================================
# 🚀 ЗАПУСК
# ==========================================================
if __name__ == "__main__":
    # Создаем пустые файлы при первом запуске, чтобы избежать ошибок
    for f in [LINKS_FILE, APPLIED_FILE, NOT_APPLIED_FILE, KEYWORDS_FILE]:
        if not os.path.exists(f):
            open(f, "w", encoding="utf-8").close()

    # Если keywords пустой, запишем дефолтные
    if not load_keywords():
        save_keywords(["Python", "QA", "AQA"])

    root = tk.Tk()
    app = AppUI(root)

    # Корректное закрытие
    def on_closing():
        if is_running:
            if not messagebox.askyesno("Выход", "Операция выполняется. Все равно выйти?"):
                return
        log_message("👋 Приложение закрыто.")
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_closing)
    root.mainloop()