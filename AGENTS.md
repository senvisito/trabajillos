# Guía para asistentes de IA (Codex, Cursor, Copilot, Gemini, Claude…)

Este repositorio contiene **tres webs** que se despliegan solas en el servidor `hosting07`:

| Servicio | Carpeta | Puerto local | Dominio |
|---|---|---|---|
| Trabajillos (marketplace de informática en València) | `/` (`src/`, `public/`) | 3010 | trabajillos.civicloud.es |
| Radiografía Web (escáner de seguridad pasivo) | `escaner/` | 3011 | escaner.civicloud.es |
| Investiga (OSINT de fuentes públicas) | `investiga/` | 3012 | investiga.civicloud.es |

## Cómo se despliega
- Cada push a `main` se instala solo: un cron en el servidor (`/usr/local/bin/trabajillos-autoupdate`, cada 5 min) hace `git reset --hard origin/main`, `docker compose build` y `docker compose up -d`. Si la construcción falla, lo reintenta.
- `docker-compose.yml` define los servicios `app`, `escaner` e `investiga`, todos publicados solo en `127.0.0.1`. Apache (ISPConfig) hace de proxy.
- Log del despliegue: `/var/log/trabajillos-update.log`.

## Stack
Node 22, Express 4, better-sqlite3 (una base SQLite por servicio en un volumen Docker), HTML renderizado en el servidor, sin frameworks de frontend. CSP estricta: nada de scripts ni estilos inline (usa archivos en `public/`).

## Reglas obligatorias
1. **Nunca subas secretos** (contraseñas, claves API). Van en `/opt/trabajillos/.env` del servidor; documenta las variables nuevas en `.env.example`.
2. **No toques ISPConfig ni otras webs del servidor.** Todo lo de este proyecto vive en Docker.
3. Las peticiones a URLs que escribe el usuario deben pasar por `src/net.js` (bloquea IPs privadas: protección SSRF).
4. Escáner: solo análisis pasivo para cualquiera; las comprobaciones de rutas sensibles solo con dominio verificado.
5. Investiga: solo fuentes públicas; para particulares, nada de domicilios, familiares, teléfonos personales ni reconocimiento facial. Respeta la tabla `optout`.
6. Todo el texto visible, en español sencillo.
7. Prueba en local antes de hacer push: `cd <servicio> && npm ci && PORT=<puerto> node src/server.js`. Un push roto deja la web anterior funcionando, pero no se actualiza.

## Variables útiles (.env)
`SITE_URL`, `ADMIN_EMAIL`, `SMTP_*`, `LEGAL_*`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `WHATSAPP_NUMBER`, `ESCANER_URL`, `INVESTIGA_URL`, `ANTHROPIC_API_KEY` (opcional: resúmenes con IA en Investiga).
