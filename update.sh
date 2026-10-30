#!/usr/bin/env bash
# Actualiza a la última versión: sudo bash /opt/trabajillos/update.sh
set -euo pipefail
cd /opt/trabajillos && git pull -q && docker compose up -d --build && docker compose ps --format 'table {{.Service}}\t{{.State}}'
