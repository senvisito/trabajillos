# Trabajillos

Trabajos de informática en València sin pagar por contacto: publicar trabajos, respuestas de profesionales,
asistente para clientes y técnicos, valoraciones tras cada trabajo, ranking y páginas por servicio y barrio.

- Node.js + Express + SQLite (un solo fichero en `data/`), HTML renderizado en servidor (bueno para SEO).
- Despliegue: Docker Compose con Caddy (HTTPS automático).

## Instalar
```bash
curl -fsSL https://raw.githubusercontent.com/senvisito/trabajillos/main/install.sh | sudo ADMIN_EMAIL=tu@correo.com bash
```
Configuración en `/opt/trabajillos/.env` (correo SMTP, datos legales). Tras cambiarla: `sudo bash /opt/trabajillos/update.sh`.

## Actualizar
`sudo bash /opt/trabajillos/update.sh`

## Copias de seguridad
Diarias en `/opt/trabajillos/backups/` (14 días).
