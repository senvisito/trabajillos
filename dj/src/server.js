// Pide por esa boquita DJ 2.0: peticiones de canciones al DJ, panel en directo, propinas directas al DJ (Stripe del DJ),
// imágenes personalizables desde el panel y varias webs (dominios) en la misma instalación.
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('cookie-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const QR = require('qrcode');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UP = path.join(DATA, 'uploads'); fs.mkdirSync(UP, { recursive: true });
const db = new Database(path.join(DATA, 'dj.db')); db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
db.exec(`CREATE TABLE IF NOT EXISTS sites (id INTEGER PRIMARY KEY, host TEXT UNIQUE NOT NULL, name TEXT NOT NULL, title TEXT, subtitle TEXT,
  accent TEXT DEFAULT '#ff2d75', bg_form TEXT, bg_thanks TEXT, bg_panel TEXT, tips_on INTEGER DEFAULT 0, tip_link TEXT, tip_text TEXT,
  pass_hash TEXT NOT NULL, open INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY, site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE, title TEXT NOT NULL, artist TEXT NOT NULL,
  artwork TEXT, preview TEXT, ext_id TEXT, requester TEXT, message TEXT, tip INTEGER DEFAULT 0, status TEXT DEFAULT 'nueva', created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS req_site ON requests(site_id, status, created_at);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);`);

// ---------- contraseña de administración y web por defecto ----------
let adminHash = (db.prepare("SELECT v FROM kv WHERE k='admin'").get() || {}).v;
if (process.env.DJ_ADMIN_PASSWORD) adminHash = bcrypt.hashSync(process.env.DJ_ADMIN_PASSWORD, 10);
if (!adminHash) {
  const pw = crypto.randomBytes(6).toString('base64url');
  adminHash = bcrypt.hashSync(pw, 10); db.prepare("INSERT INTO kv (k,v) VALUES ('admin',?)").run(adminHash);
  console.log(`\n====================================================\n  CONTRASEÑA INICIAL (admin y panel): ${pw}\n  Cámbiala desde el panel → Ajustes.\n====================================================\n`);
}
const DEFAULT_HOST = (process.env.DJ_DEFAULT_HOST || 'dj.pideporesaboquitadj.com').toLowerCase();
if (!db.prepare('SELECT 1 FROM sites').get())
  db.prepare("INSERT INTO sites (host, name, title, subtitle, pass_hash, tip_text) VALUES (?,?,?,?,?,?)")
    .run(DEFAULT_HOST, 'Pide por esa boquita DJ', 'Pide tu canción al DJ', 'Escribe la canción y te la sugerimos al momento', adminHash, 'La propina es voluntaria y va directamente al DJ. No es necesaria para pedir canciones.');

// ---------- utilidades ----------
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const okUrl = (u, hosts) => { try { const x = new URL(u); return x.protocol === 'https:' && hosts.some(hh => x.hostname === hh || x.hostname.endsWith('.' + hh)); } catch { return false; } };
const MEDIA_HOSTS = ['dzcdn.net', 'deezer.com', 'mzstatic.com', 'apple.com', 'itunes.apple.com'];
const ago = d => { const s = (Date.now() - new Date(d.replace(' ', 'T') + 'Z')) / 1000; return s < 60 ? 'ahora' : s < 3600 ? `hace ${Math.floor(s / 60)} min` : `hace ${Math.floor(s / 3600)} h`; };

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  imgSrc: ["'self'", 'data:', 'https:'], mediaSrc: ["'self'", 'https:'], connectSrc: ["'self'"], formAction: ["'self'", 'https://buy.stripe.com', 'https://donate.stripe.com'], frameAncestors: ["'none'"] } },
  crossOriginEmbedderPolicy: false }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.json({ limit: '20kb' }));
app.use(session({ name: 'dj', keys: [process.env.SESSION_SECRET || 'cambia-esto-' + adminHash.slice(-12)], maxAge: 12 * 3600e3, sameSite: 'lax', httpOnly: true }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.use('/u', express.static(UP, { maxAge: '7d' }));

// web según el dominio
app.use((req, res, next) => {
  const host = (req.hostname || '').toLowerCase().replace(/^www\./, '');
  let site = db.prepare('SELECT * FROM sites WHERE host=?').get(host);
  if (!site && /^(localhost|127\.|\d+\.\d+\.\d+\.\d+$)/.test(host)) site = db.prepare('SELECT * FROM sites ORDER BY id LIMIT 1').get();
  req.site = site;
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(16).toString('hex');
  if (req.method === 'POST' && !req.path.startsWith('/pedir')) {
    const t = req.get('x-csrf') || (req.body && req.body._csrf);
    if (t !== req.session.csrf && !req.is('multipart/form-data')) return res.status(403).send('Sesión caducada. Recarga la página.');
  }
  next();
});
const needSite = (req, res, next) => req.site ? next() : res.status(404).send('Esta web todavía no está configurada. Créala en /admin.');
const authed = req => req.site && (req.session.sites || []).includes(req.site.id);
const needPanel = (req, res, next) => authed(req) ? next() : (req.path.includes('/api/') ? res.status(401).json({ error: 'login' }) : res.redirect('/panel'));
const csrfIn = req => `<input type="hidden" name="_csrf" value="${h(req.session.csrf)}">`;

function page(req, res, { title, body, bg = 'form', bodyClass = '', script = '', status = 200 }) {
  const s = req.site || {};
  res.status(status).send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${h(title)}</title><meta name="theme-color" content="#0b0712"><link rel="icon" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@600;800&family=Manrope:wght@400;600;700;800&display=swap">
<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/site.css?v=${encodeURIComponent((s.bg_form || '') + (s.bg_thanks || '') + (s.bg_panel || '') + (s.accent || ''))}"></head>
<body class="bg-${bg} ${bodyClass}" data-csrf="${h(req.session.csrf)}">${body}${script ? `<script src="${script}"></script>` : ''}</body></html>`);
}

// CSS por web: fondos e color de acento (los fondos no pueden ir en línea por la política de seguridad)
app.get('/site.css', (req, res) => {
  const s = req.site || {}; const acc = /^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent : '#ff2d75';
  const bg = f => f ? `url("/u/${f}")` : 'none';
  res.type('css').set('cache-control', 'no-cache').send(`:root{--acc:${acc}}
body.bg-form{background-image:linear-gradient(180deg,rgba(8,4,16,.35),rgba(8,4,16,.75)),${bg(s.bg_form)}}
body.bg-thanks{background-image:linear-gradient(180deg,rgba(8,4,16,.25),rgba(8,4,16,.7)),${bg(s.bg_thanks || s.bg_form)}}
body.bg-panel{background-image:linear-gradient(180deg,rgba(8,4,16,.82),rgba(8,4,16,.92)),${bg(s.bg_panel || s.bg_form)}}`);
});

// ---------- público: pedir canción ----------
app.get('/', needSite, (req, res) => {
  const s = req.site;
  if (!s.open) return page(req, res, { title: s.name, body: `<main class="center-wrap"><section class="glass narrow"><h1>${h(s.name)}</h1><p class="big">Las peticiones están cerradas ahora mismo. ¡Gracias por venir! 🎶</p></section></main>` });
  page(req, res, { title: `${s.title || 'Pide tu canción'} · ${s.name}`, script: '/form.js', body: `<main class="center-wrap">
<form class="glass" method="post" action="/pedir" autocomplete="off" id="req">
<p class="brand">${h(s.name)}</p><h1>🎵 ${h(s.title || 'Pide tu canción al DJ')}</h1>${s.subtitle ? `<p class="sub">${h(s.subtitle)}</p>` : ''}
<label>Canción <span class="req">*</span><div class="ac"><input name="title" id="title" required maxlength="120" placeholder="Empieza a escribir… ej. despa" autocomplete="off"><ul class="sug" id="sug" hidden></ul></div></label>
<div class="picked" id="picked" hidden><img id="pimg" alt=""><div><b id="ptitle"></b><span id="partist"></span></div><button type="button" class="x" id="unpick" aria-label="Cambiar">✕</button></div>
<label id="artistBox">Artista <span class="req">*</span><input name="artist" id="artist" required maxlength="120" placeholder="Nombre del artista"></label>
<input type="hidden" name="artwork" id="artwork"><input type="hidden" name="preview" id="preview"><input type="hidden" name="ext_id" id="ext_id">
<div class="two"><label>Tu nombre <small>(opcional)</small><input name="requester" maxlength="40" placeholder="¿Quién la pide?"></label>
<label>Mensaje para el DJ <small>(opcional)</small><input name="message" maxlength="200" placeholder="Dedicatoria, cumpleaños…"></label></div>
${s.tips_on && s.tip_link ? `<label class="check"><input type="checkbox" name="tip" value="1"> 💶 Quiero dejar propina al DJ <small>(después de enviar)</small></label><p class="fine">${h(s.tip_text || '')}</p>` : ''}
<div class="hp" aria-hidden="true"><input name="web" tabindex="-1"></div>
<button class="send">🎧 Enviar petición</button></form></main>` });
});

const searchCache = new Map();
app.get('/api/buscar', needSite, rateLimit({ windowMs: 60e3, limit: 60 }), async (req, res) => {
  const q = clean(req.query.q, 80); if (q.length < 2) return res.json([]);
  const key = q.toLowerCase(); const hit = searchCache.get(key); if (hit && hit.t > Date.now() - 6e5) return res.json(hit.v);
  let out = [];
  try {
    const r = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=8`, { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    out = (j.data || []).map(t => ({ title: t.title_short || t.title, artist: t.artist && t.artist.name, artwork: t.album && t.album.cover_medium, preview: t.preview, id: 'dz:' + t.id }));
  } catch {}
  if (!out.length) try {
    const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=8&country=ES`, { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    out = (j.results || []).map(t => ({ title: t.trackName, artist: t.artistName, artwork: (t.artworkUrl100 || '').replace('100x100', '200x200'), preview: t.previewUrl, id: 'it:' + t.trackId }));
  } catch {}
  out = out.filter(t => t.title && t.artist);
  searchCache.set(key, { t: Date.now(), v: out }); if (searchCache.size > 2000) searchCache.clear();
  res.json(out);
});

app.post('/pedir', needSite, rateLimit({ windowMs: 60e3, limit: 8, message: 'Has enviado muchas peticiones seguidas. Espera un minuto.' }), (req, res) => {
  const s = req.site, b = req.body;
  if (b.web) return res.redirect('/gracias');
  if (!s.open) return res.redirect('/');
  const title = clean(b.title, 120), artist = clean(b.artist, 120);
  if (title.length < 1 || artist.length < 1) return res.redirect('/');
  const artwork = okUrl(b.artwork, MEDIA_HOSTS) ? b.artwork : null, preview = okUrl(b.preview, MEDIA_HOSTS) ? b.preview : null;
  const r = db.prepare('INSERT INTO requests (site_id, title, artist, artwork, preview, ext_id, requester, message, tip) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(s.id, title, artist, artwork, preview, clean(b.ext_id, 40) || null, clean(b.requester, 40) || null, clean(b.message, 200) || null, b.tip ? 1 : 0);
  res.redirect(`/gracias?p=${r.lastInsertRowid}${b.tip ? '&propina=1' : ''}`);
});

app.get('/gracias', needSite, (req, res) => {
  const s = req.site; const r = req.query.p && db.prepare('SELECT title, artist, artwork FROM requests WHERE id=? AND site_id=?').get(req.query.p, s.id);
  const tip = s.tips_on && s.tip_link;
  page(req, res, { title: `¡Canción enviada! · ${s.name}`, bg: 'thanks', body: `<main class="center-wrap"><section class="glass narrow thanks">
<div class="ok">✓</div><h1>¡Canción enviada!</h1>${r ? `<div class="picked show">${r.artwork ? `<img src="${h(r.artwork)}" alt="">` : ''}<div><b>${h(r.title)}</b><span>${h(r.artist)}</span></div></div>` : ''}
<p class="sub">El DJ ya la tiene en su lista. Si encaja con el momento, ¡suena! 🔊</p>
${tip ? `<a class="tipbtn${req.query.propina ? ' big' : ''}" href="${h(s.tip_link)}" target="_blank" rel="noopener">💶 Dejar propina al DJ</a><p class="fine">${h(s.tip_text || '')}</p>` : ''}
<a class="send" href="/">🎵 Pedir otra canción</a></section></main>` });
});

// ---------- panel del DJ ----------
const loginLimit = rateLimit({ windowMs: 15 * 60e3, limit: 15, message: 'Demasiados intentos. Espera 15 minutos.' });
app.get('/panel', needSite, (req, res) => {
  const s = req.site;
  if (!authed(req)) return page(req, res, { title: `Panel DJ · ${s.name}`, bg: 'panel', body: `<main class="center-wrap"><form class="glass narrow" method="post" action="/panel/entrar">${csrfIn(req)}
<p class="brand">${h(s.name)}</p><h1>Panel del DJ</h1>${req.query.e ? '<p class="err">Contraseña incorrecta</p>' : ''}<label>Contraseña<input type="password" name="pass" required autofocus></label><button class="send">Entrar</button></form></main>` });
  const url = `https://${s.host}`;
  page(req, res, { title: `Panel · ${s.name}`, bg: 'panel', bodyClass: 'panel', script: '/panel.js', body: `<header class="ptop"><div><p class="brand">${h(s.name)}</p><h1>Peticiones <span id="count" class="pill">0</span></h1></div>
<div class="pact"><button class="btn ${s.open ? 'on' : 'off'}" id="openBtn" data-open="${s.open}">${s.open ? '🟢 Abiertas' : '🔴 Cerradas'}</button>
<a class="btn" href="/panel/exportar.txt">⬇ Lista</a><a class="btn" href="/panel/cartel" target="_blank">🖨 Cartel QR</a><a class="btn" href="/panel/ajustes">⚙ Ajustes</a>
<button class="btn danger" id="clearAll">🗑 Borrar todas</button><form method="post" action="/panel/salir" class="inline">${csrfIn(req)}<button class="btn">Salir</button></form></div></header>
<nav class="tabs"><button class="tab active" data-f="nueva">Pendientes</button><button class="tab" data-f="puesta">Puestas</button><button class="tab" data-f="todas">Todas</button>
<span class="muted small">Se actualiza cada 5 s · <span id="last"></span> · Peticiones en: <b>${h(url)}</b></span></nav>
<main id="list" class="list"><p class="muted">Cargando…</p></main><audio id="player" preload="none"></audio>` });
});
app.post('/panel/entrar', needSite, loginLimit, (req, res) => {
  if (!bcrypt.compareSync(String(req.body.pass || ''), req.site.pass_hash)) return res.redirect('/panel?e=1');
  req.session.sites = [...new Set([...(req.session.sites || []), req.site.id])]; res.redirect('/panel');
});
app.post('/panel/salir', (req, res) => { req.session = null; res.redirect('/panel'); });

app.get('/panel/api/peticiones', needSite, needPanel, (req, res) => {
  const rows = db.prepare('SELECT * FROM requests WHERE site_id=? ORDER BY id DESC LIMIT 500').all(req.site.id);
  // agrupar la misma canción pedida varias veces
  const groups = new Map();
  for (const r of rows) {
    const k = (r.ext_id || (r.title + '|' + r.artist).toLowerCase()) + '|' + r.status;
    if (!groups.has(k)) groups.set(k, { ...r, ids: [], times: 0, people: [], messages: [], tips: 0, first: r.created_at });
    const g = groups.get(k); g.ids.push(r.id); g.times++; g.first = r.created_at;
    if (r.requester) g.people.push(r.requester); if (r.message) g.messages.push({ who: r.requester, text: r.message }); if (r.tip) g.tips++;
  }
  res.set('cache-control', 'no-store').json({ open: !!req.site.open, items: [...groups.values()].map(g => ({ ids: g.ids, title: g.title, artist: g.artist, artwork: g.artwork, preview: g.preview,
    status: g.status, times: g.times, people: [...new Set(g.people)], messages: g.messages.slice(0, 5), tips: g.tips, ago: ago(g.created_at), when: g.created_at })) });
});
app.post('/panel/api/estado', needSite, needPanel, (req, res) => {
  const ids = (req.body.ids || []).map(Number).filter(Boolean).slice(0, 200); const st = ['nueva', 'puesta'].includes(req.body.status) ? req.body.status : null;
  if (ids.length && st) db.prepare(`UPDATE requests SET status=? WHERE site_id=? AND id IN (${ids.map(() => '?').join(',')})`).run(st, req.site.id, ...ids);
  res.json({ ok: true });
});
app.post('/panel/api/borrar', needSite, needPanel, (req, res) => {
  const ids = (req.body.ids || []).map(Number).filter(Boolean).slice(0, 200);
  if (ids.length) db.prepare(`DELETE FROM requests WHERE site_id=? AND id IN (${ids.map(() => '?').join(',')})`).run(req.site.id, ...ids);
  res.json({ ok: true });
});
app.post('/panel/api/borrar-todas', needSite, needPanel, (req, res) => { db.prepare('DELETE FROM requests WHERE site_id=?').run(req.site.id); res.json({ ok: true }); });
app.post('/panel/api/abrir', needSite, needPanel, (req, res) => { db.prepare('UPDATE sites SET open=? WHERE id=?').run(req.body.open ? 1 : 0, req.site.id); res.json({ ok: true }); });
app.get('/panel/exportar.txt', needSite, needPanel, (req, res) => {
  const rows = db.prepare('SELECT title, artist, status, COUNT(*) n FROM requests WHERE site_id=? GROUP BY lower(title), lower(artist), status ORDER BY MIN(id)').all(req.site.id);
  res.type('text/plain; charset=utf-8').set('content-disposition', `attachment; filename="peticiones-${new Date().toISOString().slice(0, 10)}.txt"`)
    .send(rows.map(r => `${r.artist} - ${r.title}${r.n > 1 ? `  (x${r.n})` : ''}${r.status === 'puesta' ? '  [puesta]' : ''}`).join('\r\n'));
});

// cartel con QR para imprimir o poner en pantalla
app.get('/panel/qr.svg', needSite, async (req, res) => res.type('image/svg+xml').send(await QR.toString(`https://${req.site.host}/`, { type: 'svg', margin: 1, color: { dark: '#0b0712', light: '#ffffff' } })));
app.get('/panel/cartel', needSite, needPanel, (req, res) => page(req, res, { title: `Cartel · ${req.site.name}`, bodyClass: 'poster', body: `<main class="center-wrap"><section class="glass poster-card">
<p class="brand">${h(req.site.name)}</p><h1>🎵 Pide tu canción</h1><img class="qr" src="/panel/qr.svg" alt="Código QR"><p class="big">Escanea el código<br>o entra en <b>${h(req.site.host)}</b></p>
<button class="btn noprint" id="printBtn">🖨 Imprimir</button></section></main>`, script: '/print.js' }));

// ajustes: textos, propinas, imágenes y contraseña
const upload = multer({ storage: multer.diskStorage({ destination: UP, filename: (req, f, cb) => cb(null, `${req.site.id}-${f.fieldname}-${Date.now()}${{ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[f.mimetype] || ''}`) }),
  limits: { fileSize: 8e6, files: 3 }, fileFilter: (req, f, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(f.mimetype)) });
app.get('/panel/ajustes', needSite, needPanel, (req, res) => {
  const s = req.site; const img = (k, label) => `<div class="imgset"><div class="thumb">${s[k] ? `<img src="/u/${h(s[k])}" alt="">` : '<span>Sin imagen</span>'}</div>
<label>${label}<input type="file" name="${k}" accept="image/jpeg,image/png,image/webp"></label>${s[k] ? `<label class="check"><input type="checkbox" name="del_${k}" value="1"> Quitar</label>` : ''}</div>`;
  page(req, res, { title: `Ajustes · ${s.name}`, bg: 'panel', bodyClass: 'panel', body: `<header class="ptop"><div><p class="brand">${h(s.name)}</p><h1>Ajustes</h1></div><div class="pact"><a class="btn" href="/panel">← Volver al panel</a></div></header>
${req.query.ok ? '<p class="okmsg">✓ Guardado</p>' : ''}${req.query.e ? `<p class="err">${h(req.query.e)}</p>` : ''}
<form class="settings" method="post" action="/panel/ajustes?_csrf=${h(req.session.csrf)}" enctype="multipart/form-data">
<section class="glass"><h2>Textos</h2><label>Nombre de la web / DJ<input name="name" value="${h(s.name)}" maxlength="60" required></label>
<label>Título<input name="title" value="${h(s.title || '')}" maxlength="80"></label><label>Subtítulo<input name="subtitle" value="${h(s.subtitle || '')}" maxlength="140"></label>
<label>Color principal<input type="color" name="accent" value="${h(s.accent || '#ff2d75')}"></label></section>
<section class="glass"><h2>Imágenes de fondo</h2><p class="muted small">Sube una foto (JPG, PNG o WebP, máx. 8 MB). Se adapta sola a móvil y ordenador.</p>
${img('bg_form', 'Página de pedir canción')}${img('bg_thanks', 'Página de «Canción enviada»')}${img('bg_panel', 'Panel del DJ')}</section>
<section class="glass"><h2>Propinas</h2><label class="check"><input type="checkbox" name="tips_on" value="1"${s.tips_on ? ' checked' : ''}> Mostrar botón de propina</label>
<label>Enlace de pago de Stripe del DJ<input name="tip_link" value="${h(s.tip_link || '')}" placeholder="https://buy.stripe.com/..."></label>
<p class="muted small">Crea en la cuenta de Stripe del DJ un «Payment Link» con importe libre y pégalo aquí. El dinero va directo al DJ: esta web no lo toca.</p>
<label>Condiciones de la propina (se muestran al público)<textarea name="tip_text" rows="3" maxlength="600">${h(s.tip_text || '')}</textarea></label></section>
<section class="glass"><h2>Contraseña del panel</h2><label>Nueva contraseña (déjalo vacío para no cambiarla)<input type="password" name="newpass" minlength="8" autocomplete="new-password"></label></section>
<button class="send">Guardar cambios</button></form>` });
});
app.post('/panel/ajustes', needSite, needPanel, (req, res, next) => { if (req.query._csrf !== req.session.csrf) return res.status(403).send('Sesión caducada'); next(); },
  upload.fields([{ name: 'bg_form' }, { name: 'bg_thanks' }, { name: 'bg_panel' }]), (req, res) => {
  const s = req.site, b = req.body, f = req.files || {};
  const tipLink = clean(b.tip_link, 300);
  if (tipLink && !/^https:\/\/(buy|donate)\.stripe\.com\/[\w-]+$/.test(tipLink)) return res.redirect('/panel/ajustes?e=' + encodeURIComponent('El enlace de propina debe ser un Payment Link de Stripe (https://buy.stripe.com/…)'));
  const upd = { name: clean(b.name, 60) || s.name, title: clean(b.title, 80), subtitle: clean(b.subtitle, 140), accent: /^#[0-9a-f]{6}$/i.test(b.accent) ? b.accent : s.accent,
    tips_on: b.tips_on ? 1 : 0, tip_link: tipLink || null, tip_text: String(b.tip_text || '').trim().slice(0, 600) };
  for (const k of ['bg_form', 'bg_thanks', 'bg_panel']) {
    if (f[k] && f[k][0]) { upd[k] = f[k][0].filename; if (s[k]) fs.rm(path.join(UP, s[k]), () => {}); }
    else if (b['del_' + k]) { upd[k] = null; if (s[k]) fs.rm(path.join(UP, s[k]), () => {}); }
  }
  if (b.newpass && String(b.newpass).length >= 8) upd.pass_hash = bcrypt.hashSync(String(b.newpass), 10);
  const keys = Object.keys(upd);
  db.prepare(`UPDATE sites SET ${keys.map(k => `${k}=?`).join(', ')} WHERE id=?`).run(...keys.map(k => upd[k]), s.id);
  res.redirect('/panel/ajustes?ok=1');
});

// ---------- administración: varias webs / dominios ----------
const isAdmin = req => req.session.admin === true;
app.get('/admin', (req, res) => {
  if (!isAdmin(req)) return page(req, res, { title: 'Administración', bg: 'panel', body: `<main class="center-wrap"><form class="glass narrow" method="post" action="/admin/entrar">${csrfIn(req)}<h1>Administración</h1>
${req.query.e ? '<p class="err">Contraseña incorrecta</p>' : ''}<label>Contraseña de administración<input type="password" name="pass" required autofocus></label><button class="send">Entrar</button></form></main>` });
  const sites = db.prepare('SELECT s.*, (SELECT COUNT(*) FROM requests r WHERE r.site_id=s.id) n FROM sites s ORDER BY id').all();
  page(req, res, { title: 'Administración · Webs DJ', bg: 'panel', bodyClass: 'panel', body: `<header class="ptop"><div><h1>Webs de peticiones</h1><p class="muted">Cada web tiene su dominio, sus imágenes, sus propinas y su contraseña.</p></div>
<div class="pact"><form method="post" action="/panel/salir" class="inline">${csrfIn(req)}<button class="btn">Salir</button></form></div></header>${req.query.ok ? '<p class="okmsg">✓ Hecho</p>' : ''}${req.query.e ? `<p class="err">${h(req.query.e)}</p>` : ''}
<table class="sites"><tr><th>Dominio</th><th>Nombre</th><th>Peticiones</th><th></th></tr>${sites.map(s => `<tr><td><a href="https://${h(s.host)}" target="_blank">${h(s.host)}</a></td><td>${h(s.name)}</td><td>${s.n}</td>
<td><a class="btn small" href="https://${h(s.host)}/panel" target="_blank">Panel</a>${sites.length > 1 ? ` <form method="post" action="/admin/borrar" class="inline">${csrfIn(req)}<input type="hidden" name="id" value="${s.id}"><button class="btn small danger">Borrar</button></form>` : ''}</td></tr>`).join('')}</table>
<form class="glass" method="post" action="/admin/crear">${csrfIn(req)}<h2>Replicar en otro dominio</h2>
<div class="two"><label>Nuevo dominio<input name="host" placeholder="fiesta.otrodominio.com" required></label><label>Nombre<input name="name" placeholder="DJ Pepe" required maxlength="60"></label></div>
<div class="two"><label>Copiar diseño y textos de<select name="from">${sites.map(s => `<option value="${s.id}">${h(s.host)}</option>`).join('')}</select></label>
<label>Contraseña del panel de esta web<input type="password" name="pass" minlength="8" required autocomplete="new-password"></label></div><button class="send">Crear web</button>
<p class="muted small">Después, en ISPConfig crea el sitio con ese dominio (SSL + Let's Encrypt, sin PHP) y pon en «Directivas de Apache»:</p>
<pre>ProxyPreserveHost On
ProxyPass /.well-known/acme-challenge/ !
ProxyPass / http://127.0.0.1:3013/
ProxyPassReverse / http://127.0.0.1:3013/
RequestHeader set X-Forwarded-Proto "https"</pre></form>
<form class="glass" method="post" action="/admin/clave">${csrfIn(req)}<h2>Contraseña de administración</h2>
<div class="two"><label>Contraseña actual<input type="password" name="actual" required autocomplete="current-password"></label>
<label>Nueva contraseña (mín. 10 caracteres)<input type="password" name="nueva" minlength="10" required autocomplete="new-password"></label></div>
<button class="send">Cambiar contraseña de administración</button></form>` });
});
app.post('/admin/clave', loginLimit, (req, res) => {
  if (!isAdmin(req)) return res.redirect('/admin');
  if (!bcrypt.compareSync(String(req.body.actual || ''), adminHash)) return res.redirect('/admin?e=' + encodeURIComponent('La contraseña actual no es correcta'));
  const n = String(req.body.nueva || '');
  if (n.length < 10) return res.redirect('/admin?e=' + encodeURIComponent('La nueva contraseña debe tener al menos 10 caracteres'));
  adminHash = bcrypt.hashSync(n, 10);
  db.prepare("INSERT INTO kv (k,v) VALUES ('admin',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(adminHash);
  res.redirect('/admin?ok=1');
});
app.post('/admin/entrar', loginLimit, (req, res) => { if (!bcrypt.compareSync(String(req.body.pass || ''), adminHash)) return res.redirect('/admin?e=1'); req.session.admin = true; res.redirect('/admin'); });
app.post('/admin/crear', (req, res) => {
  if (!isAdmin(req)) return res.redirect('/admin');
  const host = clean(req.body.host, 120).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host)) return res.redirect('/admin?e=' + encodeURIComponent('Dominio no válido'));
  if (String(req.body.pass || '').length < 8) return res.redirect('/admin?e=' + encodeURIComponent('La contraseña debe tener al menos 8 caracteres'));
  if (db.prepare('SELECT 1 FROM sites WHERE host=?').get(host)) return res.redirect('/admin?e=' + encodeURIComponent('Ese dominio ya existe'));
  const src = db.prepare('SELECT * FROM sites WHERE id=?').get(req.body.from) || {};
  const copy = k => { if (!src[k]) return null; const nf = `copia-${Date.now()}-${src[k]}`; try { fs.copyFileSync(path.join(UP, src[k]), path.join(UP, nf)); return nf; } catch { return null; } };
  db.prepare('INSERT INTO sites (host, name, title, subtitle, accent, bg_form, bg_thanks, bg_panel, tip_text, pass_hash) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(host, clean(req.body.name, 60), src.title, src.subtitle, src.accent, copy('bg_form'), copy('bg_thanks'), copy('bg_panel'), src.tip_text, bcrypt.hashSync(String(req.body.pass), 10));
  res.redirect('/admin?ok=1');
});
app.post('/admin/borrar', (req, res) => {
  if (!isAdmin(req)) return res.redirect('/admin');
  if (db.prepare('SELECT COUNT(*) n FROM sites').get().n > 1) db.prepare('DELETE FROM sites WHERE id=?').run(req.body.id);
  res.redirect('/admin?ok=1');
});

app.use((req, res) => res.status(404).send('No encontrado'));
app.use((err, req, res, next) => { console.error(err); res.status(500).send(err.code === 'LIMIT_FILE_SIZE' ? 'La imagen pesa más de 8 MB.' : 'Algo ha fallado.'); });
const PORT = +(process.env.PORT || 3013);
if (require.main === module) app.listen(PORT, () => console.log(`DJ en :${PORT}`));
module.exports = app;
