#!/usr/bin/env bash
# Avisos instantáneos al móvil por Telegram (gratis) y botón de WhatsApp opcional.
# Antes: en Telegram habla con @BotFather, envía /newbot, ponle un nombre y copia el token.
#        Luego abre tu bot nuevo y mándale cualquier mensaje (p. ej. "hola").
# Uso: sudo bash /opt/trabajillos/avisos.sh
set -euo pipefail
export PATH=$PATH:/usr/sbin:/sbin
cd /opt/trabajillos
ENV=.env
set_var() { local k=$1 v=$2; v=${v//|/\\|}; if grep -q "^$k=" $ENV; then sed -i "s|^$k=.*|$k=$v|" $ENV; else echo "$k=$v" >> $ENV; fi; }
get_var() { grep "^$1=" $ENV | head -1 | cut -d= -f2-; }

echo "== Telegram (Enter = saltar)"
read -rsp "Token del bot de @BotFather (no se muestra): " TOKEN; echo
if [ -n "$TOKEN" ]; then
  CHAT=$(curl -s "https://api.telegram.org/bot$TOKEN/getUpdates" | grep -o '"chat":{"id":-\?[0-9]*' | tail -1 | grep -o -- '-\?[0-9]*$' || true)
  if [ -z "$CHAT" ]; then echo "No encuentro tu chat. Abre tu bot en Telegram, mándale 'hola' y vuelve a ejecutar esto."; exit 1; fi
  set_var TELEGRAM_BOT_TOKEN "$TOKEN"; set_var TELEGRAM_CHAT_ID "$CHAT"
  curl -s -o /dev/null "https://api.telegram.org/bot$TOKEN/sendMessage" --data-urlencode "chat_id=$CHAT" --data-urlencode "text=✅ Trabajillos: avisos activados. Aquí te llegarán trabajos nuevos, técnicos nuevos y peticiones de llamada."
  echo "OK: te acaba de llegar un mensaje de prueba."
fi

echo; echo "== WhatsApp (botón flotante en la web). Ojo: el número se verá en la web."
read -rp "Número con prefijo, p. ej. 34600111222 (Enter = sin botón) [$(get_var WHATSAPP_NUMBER)]: " v
[ -n "$v" ] && set_var WHATSAPP_NUMBER "$(echo "$v" | tr -cd '0-9')"

docker compose up -d --force-recreate app >/dev/null 2>&1
echo "Hecho."
