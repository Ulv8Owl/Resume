# HHAutoApply — Linux (Debian 13)

## Готовый бинарник

`dist/HHAutoApply` — один исполняемый файл для Linux x86_64 (собран на glibc 2.39, работает на Debian 13 с glibc 2.41). Python ставить не нужно.

1. Установи браузер (любой из вариантов):
   ```
   # Chromium из репозитория Debian (драйвер ставится тем же пакетом)
   sudo apt install chromium chromium-driver
   ```
   или Google Chrome с https://www.google.com/chrome/ (драйвер скачается сам при первом запуске).
2. Положи бинарник в отдельную папку и запусти:
   ```
   mkdir -p ~/hh && cp HHAutoApply ~/hh/ && cd ~/hh
   chmod +x HHAutoApply
   ./HHAutoApply
   ```
   Служебные файлы (`chrome_profile/`, `keywords.txt`, `cover_letter.txt`, `vacancies_links.txt`, `applied_links.txt`) создаются рядом с бинарником, откуда бы его ни запускали.

Программе нужен графический сеанс (X11 или Wayland через XWayland — на обычном рабочем столе Debian всё уже есть).

## Как программа ищет браузер

1. Если есть `google-chrome` — используется он, иначе `chromium`.
2. Драйвер: сначала системный `chromedriver` (пакет `chromium-driver`), затем `webdriver-manager`, затем встроенный Selenium Manager.

## Запуск из исходников

```
sudo apt install python3 python3-venv python3-tk
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python main.py
```

## Пересборка бинарника

На самом Debian 13:
```
sudo apt install python3 python3-venv python3-tk binutils
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt pyinstaller
.venv/bin/pyinstaller --onefile --clean --name HHAutoApply main.py
```
Или в Docker: `./build.sh` (результат — `dist/HHAutoApply`).

## Частые ошибки

| Ошибка | Что делать |
|---|---|
| `libxcb.so.1: cannot open shared object file` | запуск без графической среды; на сервере: `sudo apt install xorg` или запускай на десктопе |
| `cannot find Chrome binary` | не установлен браузер — `sudo apt install chromium chromium-driver` |
| `session not created: This version of ChromeDriver only supports...` | версии Chromium и драйвера разошлись — `sudo apt update && sudo apt install --only-upgrade chromium chromium-driver` |
| `user data directory is already in use` | закрой окна браузера, открытые программой |
