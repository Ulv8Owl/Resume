#!/bin/sh
# Собирает dist/HHAutoApply (Linux x86_64, Debian 13) внутри Docker
set -e
cd "$(dirname "$0")"
docker build -t hhautoapply-build .
mkdir -p dist
id=$(docker create hhautoapply-build)
docker cp "$id:/src/dist/HHAutoApply" dist/HHAutoApply
docker rm "$id" >/dev/null
echo "Готово: $(pwd)/dist/HHAutoApply"
