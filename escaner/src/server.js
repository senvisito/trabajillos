// Escáner web: radiografía gratuita de seguridad de cualquier web, explicada para que la entienda cualquiera.
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const dns = require('dns').promises;
const Database = require('better-sqlite3');
const { scan, normalizeDomain } = require('./scan');
const { get } = require('./net');

const SITE = (process.env.ESCANER_URL || 'http://localhost:3011').replace(/\/$/, '');
const CTA_URL = process.env.ESCANER_CTA_URL || 'https://trabajillos.civicloud.es/empresas?ref=escaner';
const NAME = process.env.ESCANER_NAME || 'Radiografía Web';
const L = { name: process.env.LEGAL_NAME || '[TITULAR]', nif: process.env.LEGAL_NIF || '[NIF]', addr: process.env.LEGAL_ADDRESS || '', email: process.env.LEGAL_EMAIL || process.env.ADMIN_EMAIL || '' };

const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data'); fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'escaner.db')); db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS scans (id TEXT PRIMARY KEY, domain TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pendiente', progress TEXT,
  extended INTEGER DEFAULT 0, score INTEGER, grade TEXT, result TEXT, error TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS scans_domain ON scans(domain, created_at);
CREATE TABLE IF NOT EXISTS verifs (domain TEXT NOT NULL, vid TEXT NOT NULL, token TEXT NOT NULL, verified_at TEXT, PRIMARY KEY (domain, vid));
CREATE TABLE IF NOT EXISTS stats (day TEXT PRIMARY KEY, scans INTEGER DEFAULT 0);`);

const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SEV = { critica: 'Crítico', alta: 'Alto', media: 'Medio', baja: 'Bajo', info: 'Información', ok: 'Correcto' };

// ---------- cola de análisis (máx. 3 a la vez) ----------
const queue = []; let running = 0;
function enqueue(id, domain, extended) { queue.push({ id, domain, extended }); pump(); }
function pump() {
  while (running < 3 && queue.length) {
    const job = queue.shift(); running++;
    const upd = db.prepare('UPDATE scans SET progress=? WHERE id=?');
    db.prepare("UPDATE scans SET status='analizando' WHERE id=?").run(job.id);
    scan(job.domain, { extended: job.extended, onProgress: p => upd.run(p, job.id) })
      .then(r => db.prepare("UPDATE scans SET status='hecho', score=?, grade=?, result=?, progress=NULL WHERE id=?").run(r.score, r.grade, JSON.stringify(r), job.id))
      .catch(e => db.prepare("UPDATE scans SET status='error', error=? WHERE id=?").run(String(e.message || e).slice(0, 300), job.id))
      .finally(() => { running--; pump(); });
  }
}
db.prepare("UPDATE scans SET status='error', error='Interrumpido por un reinicio' WHERE status IN ('pendiente','analizando')").run();

// ---------- app ----------
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  scriptSrc: ["'self'"], imgSrc: ["'self'", 'data:'], formAction: ["'self'"], frameAncestors: ["'none'"] } } }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1d' }));
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const limiter = rateLimit({ windowMs: 15 * 60e3, limit: 15, standardHeaders: true, legacyHeaders: false, message: 'Has hecho muchos análisis seguidos. Espera unos minutos.' });

function page(res, { title, desc, body, noindex, status = 200 }) {
  res.status(status).send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)}</title><meta name="description" content="${h(desc || 'Analiza gratis la seguridad de cualquier web: certificado, cabeceras, correo, versiones con vulnerabilidades y más. Explicado en español, sin registro.')}">
${noindex ? '<meta name="robots" content="noindex">' : ''}<meta property="og:title" content="${h(title)}"><meta property="og:image" content="${SITE}/og.png"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/style.css"></head><body>
<header class="top"><div class="wrap nav"><a class="logo" href="/"><span class="dot"></span>${h(NAME)}</a><nav><a href="/#que-mira">Qué analiza</a><a href="/sello">Sello</a><a href="/privacidad">Privacidad</a></nav></div></header>
<main class="wrap">${body}</main>
<footer class="foot"><div class="wrap"><p><b>${h(NAME)}</b> · Análisis pasivo y gratuito. Solo miramos lo que cualquier navegador ve. Nunca atacamos ni probamos contraseñas.</p>
<p class="links"><a href="/aviso-legal">Aviso legal</a><a href="/privacidad">Privacidad</a><a href="/uso-responsable">Uso responsable</a></p></div></footer></body></html>`);
}

const scanForm = (v = '') => `<form class="scanbox" method="post" action="/analizar"><input name="dominio" value="${h(v)}" placeholder="tuweb.com" required maxlength="260" autocomplete="url" inputmode="url" aria-label="Dominio a analizar"><button>Analizar gratis</button></form>`;

app.get('/', (req, res) => {
  const n = db.prepare("SELECT COUNT(*) n FROM scans WHERE status='hecho'").get().n;
  page(res, { title: `${NAME} · Analiza gratis la seguridad de cualquier web`, body: `<section class="hero">
<p class="kicker">Gratis · Sin registro · En español</p>
<h1>¿Es segura tu web?<br><span>Te lo decimos en 30 segundos.</span></h1>
<p class="lead">Escribe un dominio y te damos una radiografía: certificado, cabeceras de seguridad, correo (SPF, DMARC, DKIM), versiones con vulnerabilidades conocidas, subdominios y tecnologías. Con nota de la A a la F y qué hacer en cada caso.</p>
${scanForm()}<p class="muted small">${n ? `${n.toLocaleString('es-ES')} webs analizadas · ` : ''}Análisis pasivo: no atacamos ni probamos contraseñas.</p></section>
<section id="que-mira" class="grid3">
<div class="card"><h3>🔒 HTTPS y certificado</h3><p>Validez, caducidad, protocolos antiguos (TLS 1.0/1.1), HSTS y redirección a HTTPS.</p></div>
<div class="card"><h3>🧱 Cabeceras de seguridad</h3><p>CSP, protección contra clickjacking, cookies seguras, contenido mixto y versiones que el servidor enseña.</p></div>
<div class="card"><h3>✉️ Correo del dominio</h3><p>SPF, DMARC y DKIM: si alguien puede mandar correos haciéndose pasar por ti.</p></div>
<div class="card"><h3>🧩 Tecnologías y versiones</h3><p>WordPress, plugins, librerías, servidor y PHP, cruzado con bases públicas de vulnerabilidades.</p></div>
<div class="card"><h3>🌐 Subdominios</h3><p>Los que aparecen en registros públicos de certificados, marcando los de pruebas o administración.</p></div>
<div class="card"><h3>📈 Historial</h3><p>Vuelve a analizar y verás qué has mejorado y qué ha empeorado desde la última vez.</p></div></section>
<section class="split"><div><h2>¿Es tu web? Desbloquea el análisis ampliado</h2>
<p>Si demuestras que el dominio es tuyo (con un registro DNS o un archivo), comprobamos también si hay archivos sensibles a la vista: <code>.git</code>, <code>.env</code>, copias de configuración, listados de carpetas o usuarios de WordPress.</p>
<p><a class="btn ghost" href="/verificar">Verificar mi dominio</a></p></div>
<div><h2>Pon el sello en tu web</h2><p>Cuando saques buena nota, enseña tu sello de seguridad. Se actualiza solo con cada análisis.</p><p><img src="/sello/ejemplo.svg" alt="Sello de ejemplo" width="190" height="44"></p><p><a href="/sello">Cómo ponerlo</a></p></div></section>` });
});

app.post('/analizar', limiter, (req, res) => {
  const domain = normalizeDomain(req.body.dominio);
  if (!domain) return page(res, { title: 'Dominio no válido', status: 400, body: `<section class="hero small"><h1>Ese dominio no parece válido</h1><p class="lead">Escribe solo el dominio, por ejemplo <b>miempresa.es</b>.</p>${scanForm(req.body.dominio)}</section>` });
  const recent = db.prepare("SELECT id FROM scans WHERE domain=? AND status IN ('hecho','analizando','pendiente') AND extended=0 AND created_at > datetime('now','-10 minutes') ORDER BY created_at DESC LIMIT 1").get(domain);
  if (recent && !req.body.forzar) return res.redirect(`/informe/${recent.id}`);
  const id = crypto.randomBytes(6).toString('base64url');
  const vid = cookies(req).vid; const ver = vid && db.prepare('SELECT 1 FROM verifs WHERE domain=? AND vid=? AND verified_at IS NOT NULL').get(domain, vid);
  db.prepare('INSERT INTO scans (id, domain, extended) VALUES (?,?,?)').run(id, domain, ver ? 1 : 0);
  db.prepare("INSERT INTO stats (day, scans) VALUES (date('now'),1) ON CONFLICT(day) DO UPDATE SET scans=scans+1").run();
  enqueue(id, domain, !!ver);
  res.redirect(`/informe/${id}`);
});

app.get('/api/informe/:id', (req, res) => {
  const s = db.prepare('SELECT status, progress, error FROM scans WHERE id=?').get(req.params.id);
  res.set('cache-control', 'no-store').json(s || { status: 'no-existe' });
});

app.get('/informe/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM scans WHERE id=?').get(req.params.id);
  if (!s) return page(res, { title: 'Informe no encontrado', status: 404, noindex: true, body: `<section class="hero small"><h1>Este informe no existe</h1>${scanForm()}</section>` });
  if (s.status === 'pendiente' || s.status === 'analizando') return page(res, { title: `Analizando ${s.domain}…`, noindex: true, body: `<section class="hero small center" id="wait" data-id="${h(s.id)}">
<div class="spinner"></div><h1>Analizando <span>${h(s.domain)}</span></h1><p class="lead" id="prog">${h(s.progress || 'En cola…')}</p><p class="muted small">Suele tardar entre 15 y 40 segundos.</p></section><script src="/wait.js"></script>` });
  if (s.status === 'error') return page(res, { title: 'No se pudo analizar', noindex: true, body: `<section class="hero small"><h1>No hemos podido analizar ${h(s.domain)}</h1><p class="lead">${h(s.error)}</p>${scanForm(s.domain)}</section>` });
  const r = JSON.parse(s.result);
  const prev = db.prepare("SELECT * FROM scans WHERE domain=? AND status='hecho' AND created_at < ? ORDER BY created_at DESC LIMIT 1").get(s.domain, s.created_at);
  let cmp = '';
  if (prev) {
    const pr = JSON.parse(prev.result); const bad = x => x.findings.filter(f => !['ok', 'info'].includes(f.sev)).map(f => f.title);
    const before = new Set(bad(pr)), now = new Set(bad(r));
    const fixed = [...before].filter(t => !now.has(t)), fresh = [...now].filter(t => !before.has(t)); const d = r.score - pr.score;
    cmp = `<section class="box cmp"><h2>Desde el análisis anterior <span class="muted small">(${h(prev.created_at.slice(0, 10))})</span></h2>
<p class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '▲ +' : d < 0 ? '▼ ' : '= '}${d} puntos · nota ${h(pr.grade)} → ${h(r.grade)}</p>
${fixed.length ? `<p><b>Arreglado:</b> ${fixed.map(h).join(' · ')}</p>` : ''}${fresh.length ? `<p><b>Nuevo:</b> ${fresh.map(h).join(' · ')}</p>` : ''}</section>`;
  }
  const cats = [...new Set(r.findings.map(f => f.cat))];
  const url = `${SITE}/informe/${s.id}`;
  const shareTxt = encodeURIComponent(`Mi web ${s.domain} saca una ${r.grade} en seguridad. ¿Y la tuya?`);
  page(res, { title: `${s.domain}: nota ${r.grade} en seguridad · ${NAME}`, noindex: true, desc: `Radiografía de seguridad de ${s.domain}: ${r.score}/100.`, body: `
<section class="report-head"><div class="grade g-${r.grade}">${h(r.grade)}</div><div><p class="kicker">Informe de seguridad${r.extended ? ' · ampliado' : ''}</p><h1>${h(s.domain)}</h1>
<p class="muted">${r.score}/100 · ${new Date(r.finishedAt).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })} · ${r.counts.critica + r.counts.alta} graves, ${r.counts.media} medios, ${r.counts.baja} leves</p>
<p class="actions noprint"><button class="btn small" id="print">Descargar PDF</button> <button class="btn small ghost" id="copy" data-url="${h(url)}">Copiar enlace</button>
<a class="btn small ghost" href="https://wa.me/?text=${shareTxt}%20${encodeURIComponent(url)}" target="_blank" rel="noopener">WhatsApp</a>
<form method="post" action="/analizar" class="inline"><input type="hidden" name="dominio" value="${h(s.domain)}"><input type="hidden" name="forzar" value="1"><button class="btn small ghost">Volver a analizar</button></form></p></div></section>
${cmp}
<section class="sumbar">${['critica', 'alta', 'media', 'baja', 'ok'].map(k => `<div class="s-${k}"><b>${r.counts[k]}</b><span>${SEV[k]}</span></div>`).join('')}</section>
${(r.counts.critica + r.counts.alta + r.counts.media) ? `<aside class="cta noprint"><div><h2>¿Te ayudamos a arreglarlo?</h2><p>Técnicos de informática de València lo revisan y te dicen cuánto cuesta. Sin compromiso.</p></div><a class="btn" href="${h(CTA_URL)}" target="_blank" rel="noopener">Pedir ayuda</a></aside>` : ''}
${cats.map(c => `<section class="cat"><h2>${h(c)}</h2>${r.findings.filter(f => f.cat === c).map(f => `<details class="f f-${f.sev}"${['critica', 'alta', 'media'].includes(f.sev) ? ' open' : ''}>
<summary><span class="sev">${SEV[f.sev]}</span>${h(f.title)}${f.confidence === 'indicio' ? ' <span class="conf" title="Lo deducimos de lo que la web muestra; puede que tenga parches aplicados">indicio</span>' : ''}</summary>
<p>${h(f.detail)}</p>${f.fix ? `<p class="fix"><b>Cómo arreglarlo:</b> ${h(f.fix)}</p>` : ''}${f.evidence ? `<pre>${h(f.evidence)}</pre>` : ''}</details>`).join('')}</section>`).join('')}
<section class="cat"><h2>Tecnologías detectadas</h2>${r.tech.length ? `<table><tr><th>Tecnología</th><th>Tipo</th><th>Versión</th></tr>${r.tech.map(t => `<tr><td>${h(t.name)}</td><td>${h(t.category)}</td><td>${h(t.version || '—')}${t.latest ? ` <span class="muted small">(última ${h(t.latest)})</span>` : ''}</td></tr>`).join('')}</table>` : '<p class="muted">No hemos identificado tecnologías conocidas.</p>'}</section>
<section class="cat two"><div><h2>Servidor</h2><table>
<tr><td>IP</td><td>${h([...r.dns.A, ...r.dns.AAAA].join(', ') || '—')}</td></tr><tr><td>Nombre inverso</td><td>${h((r.dns.ptr || []).join(', ') || '—')}</td></tr>
<tr><td>Servidores DNS</td><td>${h(r.dns.NS.join(', ') || '—')}</td></tr><tr><td>Correo (MX)</td><td>${h(r.dns.MX.map(m => m.exchange).join(', ') || '—')}</td></tr>
<tr><td>DNSSEC</td><td>${r.dns.DNSSEC ? 'Activado' : 'No'}</td></tr><tr><td>Protocolo</td><td>${h(r.tls?.protocol || '—')}</td></tr>
<tr><td>Respuesta</td><td>${r.http ? `${r.http.status} · ${(r.http.ms / 1000).toFixed(2)} s` : '—'}</td></tr></table></div>
<div><h2>Subdominios públicos (${r.subdomains.length})</h2>${r.subdomains.length ? `<ul class="subs">${r.subdomains.map(x => `<li>${h(x)}</li>`).join('')}</ul>` : '<p class="muted">No aparecen en registros públicos de certificados.</p>'}</div></section>
${!r.extended ? `<aside class="box noprint"><h2>¿Es tu web?</h2><p>Verifica el dominio y haremos también el análisis ampliado: archivos sensibles expuestos, listados de carpetas y usuarios de WordPress.</p><a class="btn ghost" href="/verificar?d=${encodeURIComponent(s.domain)}">Verificar ${h(s.domain)}</a></aside>` : ''}
<p class="muted small">Análisis pasivo de lo que la web muestra públicamente. Lo marcado como "indicio" se deduce de versiones anunciadas: puede que el servidor tenga parches aplicados. No sustituye a una auditoría completa.</p>
<script src="/report.js"></script>` });
});

// ---------- verificación de propietario ----------
function vidOf(req, res) {
  let vid = cookies(req).vid;
  if (!vid || !/^[\w-]{16,}$/.test(vid)) { vid = crypto.randomBytes(16).toString('base64url'); res.cookie('vid', vid, { httpOnly: true, sameSite: 'lax', secure: SITE.startsWith('https'), maxAge: 90 * 864e5 }); }
  return vid;
}
app.get('/verificar', (req, res) => {
  const domain = normalizeDomain(req.query.d);
  if (!domain) return page(res, { title: 'Verificar dominio', body: `<section class="hero small"><h1>Verifica que la web es tuya</h1><p class="lead">Así podemos hacer el análisis ampliado.</p>
<form class="scanbox" method="get" action="/verificar"><input name="d" placeholder="tuweb.com" required><button>Continuar</button></form></section>` });
  const vid = vidOf(req, res);
  let v = db.prepare('SELECT * FROM verifs WHERE domain=? AND vid=?').get(domain, vid);
  if (!v) { db.prepare('INSERT INTO verifs (domain, vid, token) VALUES (?,?,?)').run(domain, vid, 'rw-' + crypto.randomBytes(12).toString('hex')); v = db.prepare('SELECT * FROM verifs WHERE domain=? AND vid=?').get(domain, vid); }
  page(res, { title: `Verificar ${domain}`, noindex: true, body: `<section class="narrow"><h1>Verificar ${h(domain)}</h1>
${v.verified_at ? `<p class="ok">✔ Verificado. Ya puedes hacer el análisis ampliado.</p><form method="post" action="/analizar"><input type="hidden" name="dominio" value="${h(domain)}"><input type="hidden" name="forzar" value="1"><button class="btn">Hacer análisis ampliado</button></form>` : `
<p>Elige <b>una</b> de estas dos formas:</p>
<div class="card"><h3>Opción 1 · Registro DNS</h3><p>Añade un registro <b>TXT</b> en <code>${h(domain)}</code> con este valor:</p><pre>escaner-verificacion=${h(v.token)}</pre></div>
<div class="card"><h3>Opción 2 · Archivo en la web</h3><p>Sube un archivo a <code>https://${h(domain)}/.well-known/escaner-verificacion.txt</code> con este contenido:</p><pre>${h(v.token)}</pre></div>
<form method="post" action="/verificar"><input type="hidden" name="d" value="${h(domain)}"><button class="btn">Ya lo he puesto, comprobar</button></form>
${req.query.fallo ? '<p class="error">Todavía no lo vemos. Los cambios de DNS pueden tardar unos minutos.</p>' : ''}`}
<p class="muted small">Solo hacemos el análisis ampliado en dominios verificados. Así evitamos que nadie lo use contra webs ajenas.</p></section>` });
});
app.post('/verificar', limiter, async (req, res) => {
  const domain = normalizeDomain(req.body.d); const vid = cookies(req).vid;
  const v = domain && vid && db.prepare('SELECT * FROM verifs WHERE domain=? AND vid=?').get(domain, vid);
  if (!v) return res.redirect('/verificar?d=' + encodeURIComponent(req.body.d || ''));
  let ok = false;
  try { ok = (await dns.resolveTxt(domain)).some(t => t.join('') === `escaner-verificacion=${v.token}`); } catch {}
  if (!ok) try { const r = await get(`https://${domain}/.well-known/escaner-verificacion.txt`, { maxBytes: 2000, follow: 2 }); ok = r.status === 200 && r.body.trim() === v.token; } catch {}
  if (ok) db.prepare("UPDATE verifs SET verified_at=datetime('now') WHERE domain=? AND vid=?").run(domain, vid);
  res.redirect(`/verificar?d=${encodeURIComponent(domain)}${ok ? '' : '&fallo=1'}`);
});

// ---------- sello para poner en la web ----------
function badge(domain, grade, score) {
  const col = { A: '#16a34a', B: '#65a30d', C: '#ca8a04', D: '#ea580c', E: '#dc2626', F: '#b91c1c' }[grade] || '#64748b';
  const label = grade ? `Seguridad ${grade} · ${score}/100` : 'Sin analizar';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="190" height="44" role="img" aria-label="${h(label)}"><rect width="190" height="44" rx="10" fill="#0f172a"/><rect x="4" y="4" width="36" height="36" rx="8" fill="${col}"/>
<text x="22" y="29" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#fff" text-anchor="middle">${h(grade || '?')}</text>
<text x="50" y="19" font-family="Arial,sans-serif" font-size="11" fill="#94a3b8">${h(NAME)}</text><text x="50" y="34" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#fff">${h(label)}</text></svg>`;
}
app.get('/sello/:domain.svg', (req, res) => {
  const d = req.params.domain === 'ejemplo' ? null : normalizeDomain(req.params.domain);
  const s = d && db.prepare("SELECT grade, score FROM scans WHERE domain=? AND status='hecho' ORDER BY created_at DESC LIMIT 1").get(d);
  res.type('image/svg+xml').set('cache-control', 'public, max-age=3600').send(req.params.domain === 'ejemplo' ? badge('', 'A', 94) : badge(d, s && s.grade, s && s.score));
});
app.get('/sello', (req, res) => page(res, { title: `Sello de seguridad · ${NAME}`, body: `<section class="narrow prose"><h1>Pon el sello de seguridad en tu web</h1>
<p>Analiza tu web y pega este código donde quieras (por ejemplo, en el pie de página). Cambia <code>tuweb.com</code> por tu dominio. El sello muestra siempre la nota del último análisis.</p>
<pre>&lt;a href="${SITE}/?ref=sello"&gt;&lt;img src="${SITE}/sello/tuweb.com.svg" alt="Sello de seguridad" width="190" height="44"&gt;&lt;/a&gt;</pre>
<p><img src="/sello/ejemplo.svg" alt="Ejemplo" width="190" height="44"></p></section>` }));

// ---------- legales ----------
const info = (p, t, html) => app.get(p, (req, res) => page(res, { title: `${t} · ${NAME}`, body: `<section class="narrow prose"><h1>${t}</h1>${html}</section>` }));
info('/aviso-legal', 'Aviso legal', `<p>Titular: ${h(L.name)} · NIF ${h(L.nif)} · ${h(L.addr)} · ${h(L.email)}.</p><p>${h(NAME)} ofrece análisis automáticos e informativos. No garantiza la ausencia de vulnerabilidades ni sustituye a una auditoría profesional.</p>`);
info('/privacidad', 'Privacidad', `<p>Responsable: ${h(L.name)} (${h(L.email)}).</p><p>Guardamos el dominio analizado y el resultado para poder enseñarte el informe y compararlo con análisis futuros. No pedimos datos personales ni registro. Los informes no se publican: solo los ve quien tiene el enlace.</p>
<p>Usamos una única cookie técnica (<code>vid</code>) solo si verificas un dominio, para recordar que lo has verificado. No usamos analítica ni publicidad de terceros.</p>`);
info('/uso-responsable', 'Uso responsable', `<p>El análisis estándar es <b>pasivo</b>: consulta DNS públicos, registros públicos de certificados y carga la página como lo haría un navegador. No hace escaneo de puertos, no prueba contraseñas ni envía ataques.</p>
<p>El análisis ampliado (rutas sensibles conocidas) solo se hace en dominios cuya propiedad se ha verificado.</p><p>Si eres responsable de una web y no quieres que se analice, escríbenos a ${h(L.email)}.</p>`);
app.get('/robots.txt', (req, res) => res.type('text').send(`User-agent: *\nAllow: /\nDisallow: /informe/\nDisallow: /api/\nSitemap: ${SITE}/sitemap.xml\n`));
app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/sello', '/verificar', '/uso-responsable'].map(u => `<url><loc>${SITE}${u}</loc></url>`).join('')}</urlset>`));
app.use((req, res) => page(res, { title: 'No encontrado', status: 404, body: `<section class="hero small"><h1>Esta página no existe</h1>${scanForm()}</section>` }));
app.use((err, req, res, next) => { console.error(err); res.status(500).send('Algo ha fallado.'); });

const PORT = +(process.env.PORT || 3011);
if (require.main === module) app.listen(PORT, () => console.log(`Escáner en :${PORT} (${SITE})`));
module.exports = app;
