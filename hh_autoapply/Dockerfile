# Сборка бинарника HHAutoApply под Debian 13 (trixie)
FROM debian:trixie
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-venv python3-tk python3-dev binutils ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY requirements.txt .
RUN python3 -m venv /venv && /venv/bin/pip install --no-cache-dir -r requirements.txt pyinstaller
COPY main.py .
RUN /venv/bin/pyinstaller --onefile --clean --name HHAutoApply main.py
