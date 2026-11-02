#!/usr/bin/env bash
# Sirve la app en http://localhost:8080 (localhost cuenta como seguro: el service worker funciona).
cd "$(dirname "$0")/../app" && exec python3 -m http.server "${1:-8080}"
