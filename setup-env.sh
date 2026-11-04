#!/usr/bin/env bash
# Configura correo saliente y datos legales de Trabajillos preguntando en pantalla.
# Uso: sudo bash /opt/trabajillos/setup-env.sh
set -euo pipefail
export PATH=$PATH:/usr/sbin:/sbin
cd /opt/trabajillos
ENV=.env
set_var() { local k=$1 v=$2; v=${v//|/\\|}; if grep -q "^$k=" $ENV; then sed -i "s|^$k=.*|$k=$v|" $ENV; else echo "$k=$v" >> $ENV; fi; }
get_var() { grep "^$1=" $ENV | head -1 | cut -d= -f2-; }

echo "== Nueva clave de sesión (la anterior se vio en una captura)"
set_var SESSION_SECRET "$(openssl rand -hex 32)"

echo; echo "== Correo saliente (para avisos de trabajos, respuestas y contraseñas)"
echo "   Usa un buzón que hayas creado, p. ej. no-reply@civicloud.es. Enter = dejar como está."
read -rp "Servidor SMTP [$(get_var SMTP_HOST)]: " v; [ -n "$v" ] && set_var SMTP_HOST "$v"
read -rp "Puerto [$(get_var SMTP_PORT)]: " v; [ -n "$v" ] && set_var SMTP_PORT "$v"
read -rp "Usuario (correo del buzón) [$(get_var SMTP_USER)]: " v; [ -n "$v" ] && { set_var SMTP_USER "$v"; set_var MAIL_FROM "Trabajillos <$v>"; }
read -rsp "Contraseña del buzón (no se muestra): " v; echo; [ -n "$v" ] && set_var SMTP_PASS "$v"

echo; echo "== Datos legales del titular (salen en Aviso legal y Privacidad)"
read -rp "Titular (nombre o empresa) [$(get_var LEGAL_NAME)]: " v; [ -n "$v" ] && set_var LEGAL_NAME "$v"
read -rp "NIF/CIF [$(get_var LEGAL_NIF)]: " v; [ -n "$v" ] && set_var LEGAL_NIF "$v"
read -rp "Dirección [$(get_var LEGAL_ADDRESS)]: " v; [ -n "$v" ] && set_var LEGAL_ADDRESS "$v"
read -rp "Correo de contacto legal [$(get_var ADMIN_EMAIL)]: " v; set_var LEGAL_EMAIL "${v:-$(get_var ADMIN_EMAIL)}"
chmod 600 $ENV

echo; echo "== Aplicando cambios"
docker compose up -d --force-recreate app >/dev/null 2>&1
sleep 4
curl -s -o /dev/null -w "Web: HTTP %{http_code}\n" http://127.0.0.1:${APP_PORT:-3010}/

if [ -n "$(get_var SMTP_HOST)" ]; then
  echo "== Enviando correo de prueba a $(get_var ADMIN_EMAIL)"
  docker compose exec -T app node -e "
    const nm=require('nodemailer');const e=process.env;
    nm.createTransport({host:e.SMTP_HOST,port:+e.SMTP_PORT,secure:+e.SMTP_PORT===465,auth:{user:e.SMTP_USER,pass:e.SMTP_PASS}})
    .sendMail({from:e.MAIL_FROM,to:e.ADMIN_EMAIL,subject:'Trabajillos: correo funcionando',text:'Si lees esto, los avisos de la web ya se envían.'})
    .then(()=>console.log('OK: correo enviado. Revisa tu bandeja (y spam).')).catch(x=>console.log('ERROR correo:',x.message))"
fi
echo; echo "Hecho. Las sesiones abiertas se han cerrado por la nueva clave: vuelve a entrar en la web."
