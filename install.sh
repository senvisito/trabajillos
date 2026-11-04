#!/usr/bin/env bash
# Instalación de Trabajillos en un servidor Ubuntu/Debian con un solo comando.
# Uso: curl -fsSL https://raw.githubusercontent.com/senvisito/trabajillos/main/install.sh | sudo ADMIN_EMAIL=tu@correo.com bash
set -euo pipefail
DIR=/opt/trabajillos
DOMAIN=${DOMAIN:-trabajillos.civicloud.es}
: "${ADMIN_EMAIL:?Falta ADMIN_EMAIL (tu correo de administrador)}"

if ! command -v docker >/dev/null; then
  echo "== Instalando Docker"; curl -fsSL https://get.docker.com | sh
fi
command -v git >/dev/null || (apt-get update -qq && apt-get install -y -qq git)

if [ -d "$DIR/.git" ]; then git -C "$DIR" pull -q; else git clone -q https://github.com/senvisito/trabajillos "$DIR"; fi
cd "$DIR"
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|; s|^SITE_URL=.*|SITE_URL=https://$DOMAIN|; s|^ADMIN_EMAIL=.*|ADMIN_EMAIL=$ADMIN_EMAIL|; s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" .env
  chmod 600 .env
fi
mkdir -p data && chown 1000:1000 data
docker rm -f trabajillos-caddy-1 >/dev/null 2>&1 || true
if ss -ltn | grep -qE ':(80|443) '; then
  MODE=proxy
  grep -q '^COMPOSE_PROFILES=' .env && sed -i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=/' .env || echo 'COMPOSE_PROFILES=' >> .env
else
  MODE=caddy
  grep -q '^COMPOSE_PROFILES=' .env && sed -i 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=caddy/' .env || echo 'COMPOSE_PROFILES=caddy' >> .env
fi
docker compose up -d --build
# Copia de seguridad diaria de la base de datos (se guardan 14 días)
cat > /etc/cron.daily/trabajillos-backup <<CRON
#!/bin/sh
mkdir -p $DIR/backups && cp $DIR/data/trabajillos.db $DIR/backups/trabajillos-\$(date +%F).db 2>/dev/null
find $DIR/backups -name '*.db' -mtime +14 -delete
CRON
chmod +x /etc/cron.daily/trabajillos-backup
# Actualización automática: cada 5 minutos comprueba GitHub y, si hay cambios, reconstruye la web
cat > /usr/local/bin/trabajillos-autoupdate <<'UPD'
#!/bin/sh
cd /opt/trabajillos || exit 0
git fetch -q origin main || exit 0
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && exit 0
git reset -q --hard origin/main && docker compose up -d --build --remove-orphans >> /var/log/trabajillos-update.log 2>&1
echo "$(date -Is) actualizado a $(git rev-parse --short HEAD)" >> /var/log/trabajillos-update.log
UPD
chmod +x /usr/local/bin/trabajillos-autoupdate
echo '*/5 * * * * root /usr/local/bin/trabajillos-autoupdate' > /etc/cron.d/trabajillos-autoupdate
sleep 5
echo; echo "== Estado"; docker compose ps --format 'table {{.Service}}\t{{.State}}'
echo; echo "== Prueba de la aplicación"; curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:${APP_PORT:-3010}/ || true
if [ "$MODE" = proxy ]; then
  echo; echo "== Los puertos 80/443 ya los usa otro servidor web. Pásale esto a Claude:"
  ss -ltnp | grep -E ':(80|443) ' | awk '{print $4, $NF}'
  for s in apache2 nginx; do systemctl is-active --quiet $s && echo "activo: $s"; done
  [ -d /usr/local/ispconfig ] && echo "ISPConfig: si"
  echo "La web funciona en 127.0.0.1:${APP_PORT:-3010}; falta publicarla en https://$DOMAIN a traves de ese servidor."
else
  echo; echo "Listo. Abre https://$DOMAIN y crea tu cuenta con $ADMIN_EMAIL (sera la de administrador)."
fi
