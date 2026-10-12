#!/usr/bin/env bash
# Шифрует видео-награды для «Академии QA».
#
# Оригиналы лежат в папке, доступной только root. Скрипт запускается через sudo, шифрует каждый файл
# 1.mp4, 2.mp3 … паролем и кладёт результат в папку mp3 игры как 1.js, 2.js …
# Открыть эти файлы напрямую нельзя: игра спрашивает пароль и расшифровывает видео только в памяти.
#
#   sudo bash tools/encrypt-videos.sh /root/qa-videos ./mp3
#
# Повторный запуск с тем же паролем перешифрует всё заново (например, когда добавились новые видео).
# Нужны bash, openssl 1.1.1+ и base64 — они есть в любом современном Linux.
set -euo pipefail

SRC=${1:?'Укажи папку с оригиналами: sudo bash tools/encrypt-videos.sh /путь/к/видео ./mp3'}
DST=${2:?'Укажи папку mp3 игры: sudo bash tools/encrypt-videos.sh /путь/к/видео ./mp3'}
[ -d "$SRC" ] || { echo "Нет папки $SRC" >&2; exit 1; }

read -rsp 'Пароль для видео: ' P1; echo
read -rsp 'Повтори пароль: ' P2; echo
[ -n "$P1" ] || { echo 'Пароль пустой.' >&2; exit 1; }
[ "$P1" = "$P2" ] || { echo 'Пароли не совпадают.' >&2; exit 1; }
export QA_PASS="$P1"

mkdir -p "$DST"
# Параметры должны совпадать с расшифровкой в rewards.js: AES-256-CTR, PBKDF2-SHA256, 100 000 итераций.
enc() { openssl enc -aes-256-ctr -pbkdf2 -iter 100000 -md sha256 -salt -pass env:QA_PASS; }

# check.js — по нему игра проверяет, что пароль верный
printf 'qa-academy-ok' | enc | { printf 'QAVault.check("'; base64 -w0; printf '");\n'; } > "$DST/check.js"

n=0
for f in "$SRC"/*; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  id=${name%.*}
  ext=${name##*.}
  ext=${ext,,}
  [[ "$id" =~ ^[0-9]+$ ]] || continue
  case "$ext" in mp3|mp4|m4v|mov|webm) ;; *) continue ;; esac
  {
    printf 'QAVault.put(%s,"%s","' "$((10#$id))" "$ext"
    enc < "$f" | base64 -w0
    printf '");\n'
  } > "$DST/$id.js.tmp"
  mv "$DST/$id.js.tmp" "$DST/$((10#$id)).js"
  n=$((n + 1))
  printf '\rЗашифровано: %d' "$n"
done
echo

# Зашифрованные файлы должны читаться браузером, то есть твоим пользователем, а не root.
owner=${SUDO_USER:-$(id -un)}
chown "$owner": "$DST" "$DST"/*.js
chmod 755 "$DST"
chmod 644 "$DST"/*.js
echo "Готово: $n видео в $DST. Владелец — $owner."
