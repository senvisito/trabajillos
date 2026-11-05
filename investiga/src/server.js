// Investiga: informes de fuentes abiertas sobre empresas, webs, teléfonos, correos y presencia profesional pública.
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { investigate, aiSummary } = require('./osint');

const SITE = (process.env.INVESTIGA_URL || 'http://localhost:3012').replace(/\/$/, '');
const NAME = process.env.INVESTIGA_NAME || 'Investiga';
const CTA_URL = process.env.INVESTIGA_CTA_URL || 'https://trabajillos.civicloud.es/empresas?ref=investiga';
const L = { name: process.env.LEGAL_NAME || '[TITULAR]', nif: process.env.LEGAL_NIF || '[NIF]', addr: process.env.LEGAL_ADDRESS || '', email: process.env.LEGAL_EMAIL || process.env.ADMIN_EMAIL || '' };

const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data'); fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'investiga.db')); db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, query TEXT NOT NULL, type TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'pendiente',
  progress TEXT, result TEXT, ai TEXT, error TEXT, ip_hash TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS optout (id INTEGER PRIMARY KEY, term TEXT NOT NULL, contact TEXT, reason TEXT, created_at TEXT DEFAULT (datetime('now')));`);
db.prepare("UPDATE reports SET status='error', error='Interrumpido por un reinicio' WHERE status IN ('pendiente','analizando')").run();

const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TYPES = { auto: 'Detectar automáticamente', empresa: 'Empresa o marca', web: 'Web o dominio', persona: 'Persona (perfil público o profesional)', telefono: 'Teléfono', correo: 'Correo electrónico', cif: 'CIF de empresa' };
const LVL = { alerta: 'Alerta', atencion: 'A tener en cuenta', bien: 'Bien' };

// cola (máx. 3 a la vez)
const queue = []; let running = 0;
function enqueue(id, input) { queue.push({ id, input }); pump(); }
function pump() {
  while (running < 3 && queue.length) {
    const { id, input } = queue.shift(); running++;
    const upd = db.prepare('UPDATE reports SET progress=? WHERE id=?');
    db.prepare("UPDATE reports SET status='analizando' WHERE id=?").run(id);
    investigate(input, p => upd.run(p, id))
      .then(async r => { const ai = await aiSummary(r); db.prepare("UPDATE reports SET status='hecho', type=?, result=?, ai=?, progress=NULL WHERE id=?").run(r.type, JSON.stringify(r), ai, id); })
      .catch(e => db.prepare("UPDATE reports SET status='error', error=? WHERE id=?").run(String(e.message || e).slice(0, 300), id))
      .finally(() => { running--; pump(); });
  }
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  scriptSrc: ["'self'"], imgSrc: ["'self'", 'data:'], formAction: ["'self'"], frameAncestors: ["'none'"] } } }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1d' }));
const limiter = rateLimit({ windowMs: 60 * 60e3, limit: 20, standardHeaders: true, legacyHeaders: false, message: 'Has hecho muchas consultas. Vuelve dentro de un rato.' });

function page(res, { title, desc, body, noindex, status = 200 }) {
  res.status(status).send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)}</title><meta name="description" content="${h(desc || '¿Es fiable esta empresa, web, teléfono o correo? Reunimos gratis la información pública con sus fuentes para que decidas.')}">
${noindex ? '<meta name="robots" content="noindex">' : ''}<link rel="icon" href="/favicon.svg"><link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800&family=Inter:wght@400;500;600;700&display=swap"><link rel="stylesheet" href="/style.css"></head><body>
<header class="top"><div class="wrap nav"><a class="logo" href="/"><span class="lens"></span>${h(NAME)}</a><nav><a href="/#como">Cómo funciona</a><a href="/uso-responsable">Uso responsable</a><a href="/privacidad">Privacidad</a></nav></div></header>
<main class="wrap">${body}</main>
<footer class="foot"><div class="wrap"><p><b>${h(NAME)}</b> · Información pública, con sus fuentes, para decidir si te fías. No vendemos datos ni guardamos perfiles de personas.</p>
<p class="links"><a href="/aviso-legal">Aviso legal</a><a href="/privacidad">Privacidad</a><a href="/uso-responsable">Uso responsable</a><a href="/exclusion">Solicitar exclusión</a></p></div></footer></body></html>`);
}

const form = (v = {}) => `<form class="search" method="post" action="/investigar">
<div class="row1"><input name="q" value="${h(v.q || '')}" placeholder="Empresa, web, teléfono, correo o CIF" required maxlength="200" aria-label="Qué investigar">
<select name="tipo" aria-label="Tipo">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}"${v.tipo === k ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
<textarea name="notas" rows="2" maxlength="1500" placeholder="Lo que ya sabes (opcional): su web, la ciudad, qué te han ofrecido, el mensaje que te llegó…">${h(v.notas || '')}</textarea>
<label class="check"><input type="checkbox" name="ok" value="1" required> Usaré esta información de forma legal y responsable (<a href="/uso-responsable" target="_blank">normas</a>).</label>
<button>Investigar gratis</button></form>`;

app.get('/', (req, res) => page(res, { title: `${NAME} · ¿Es de fiar? Investiga gratis empresas, webs, teléfonos y correos`, body: `<section class="hero">
<p class="kicker">Gratis · Sin registro · Con fuentes</p><h1>¿Es de fiar?<br><em>Investígalo antes de pagar.</em></h1>
<p class="lead">Escribe una empresa, una web, un teléfono, un correo o un CIF. Reunimos lo que es público —registros, aviso legal, antigüedad del dominio, noticias— y te lo damos ordenado, con la fuente de cada dato y las señales de alerta.</p>
${form({ tipo: 'auto' })}</section>
<section id="como" class="grid3">
<div class="card"><h3>🏢 Empresas</h3><p>Razón social, CIF y su validez, registro mercantil, antigüedad de la web, noticias, y enlaces directos al BORME y directorios.</p></div>
<div class="card"><h3>🌐 Webs y tiendas</h3><p>Desde cuándo existe el dominio, quién dice ser en su aviso legal, si da CIF real, cómo gestiona el correo y su seguridad.</p></div>
<div class="card"><h3>📞 Teléfonos y correos</h3><p>Si es móvil, fijo o de pago (806, 905…), si el correo es desechable o gratuito, y dónde ver opiniones de otros usuarios.</p></div>
<div class="card"><h3>👤 Personas con perfil público</h3><p>Solo presencia pública y profesional: cargos, noticias, Wikipedia. Nada de domicilios, familia ni datos íntimos.</p></div>
<div class="card"><h3>🔎 Cada dato con su fuente</h3><p>Fuente, fecha y nivel de confianza en cada línea, para que distingas lo comprobado de lo que es solo un indicio.</p></div>
<div class="card"><h3>🧾 Informe para guardar</h3><p>Descárgalo en PDF o compártelo con un enlace privado.</p></div></section>` }));

app.post('/investigar', limiter, (req, res) => {
  const q = String(req.body.q || '').trim(), tipo = TYPES[req.body.tipo] ? req.body.tipo : 'auto', notas = String(req.body.notas || '').slice(0, 1500);
  if (q.length < 2 || !req.body.ok) return page(res, { title: 'Revisa el formulario', status: 400, body: `<section class="hero small"><h1>Falta algo</h1><p class="lead">Escribe qué quieres investigar y acepta el uso responsable.</p>${form({ q, tipo, notas })}</section>` });
  const blocked = db.prepare('SELECT term FROM optout').all().some(o => q.toLowerCase().includes(o.term.toLowerCase()));
  if (blocked) return page(res, { title: 'No disponible', body: `<section class="hero small"><h1>No podemos investigar esto</h1><p class="lead">La persona o entidad ha solicitado su exclusión.</p></section>` });
  const id = crypto.randomBytes(7).toString('base64url');
  const ip = crypto.createHash('sha256').update(String(req.ip) + new Date().toISOString().slice(0, 10)).digest('hex').slice(0, 16);
  db.prepare('INSERT INTO reports (id, query, type, notes, ip_hash) VALUES (?,?,?,?,?)').run(id, q, tipo, notas, ip);
  enqueue(id, { query: q, type: tipo, notes: notas });
  res.redirect(`/informe/${id}`);
});
app.get('/api/informe/:id', (req, res) => { const s = db.prepare('SELECT status, progress FROM reports WHERE id=?').get(req.params.id); res.set('cache-control', 'no-store').json(s || { status: 'no-existe' }); });

app.get('/informe/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM reports WHERE id=?').get(req.params.id);
  if (!s) return page(res, { title: 'No encontrado', status: 404, noindex: true, body: `<section class="hero small"><h1>Este informe no existe o ha caducado</h1>${form({ tipo: 'auto' })}</section>` });
  if (s.status === 'pendiente' || s.status === 'analizando') return page(res, { title: `Investigando ${s.query}…`, noindex: true, body: `<section class="hero small center" id="wait" data-id="${h(s.id)}"><div class="spinner"></div>
<h1>Investigando <em>${h(s.query)}</em></h1><p class="lead" id="prog">${h(s.progress || 'En cola…')}</p><p class="muted small">Consultamos varias fuentes públicas; suele tardar entre 10 y 40 segundos.</p></section><script src="/wait.js"></script>` });
  if (s.status === 'error') return page(res, { title: 'No se pudo completar', noindex: true, body: `<section class="hero small"><h1>No hemos podido completar la investigación</h1><p class="lead">${h(s.error)}</p>${form({ q: s.query, tipo: s.type })}</section>` });
  const r = JSON.parse(s.result);
  const groups = {}; for (const f of r.facts) (groups[f.source] = groups[f.source] || []).push(f);
  const url = `${SITE}/informe/${s.id}`;
  const cnt = k => r.signals.filter(x => x.level === k).length;
  page(res, { title: `Informe: ${s.query} · ${NAME}`, noindex: true, body: `
<section class="rhead"><p class="kicker">Informe de fuentes abiertas · ${h(TYPES[r.type] || r.type)}</p><h1>${h(s.query)}</h1>
<p class="muted">${new Date(r.createdAt).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })} · ${r.facts.length} datos · ${new Set(r.facts.map(f => f.source)).size} fuentes</p>
<p class="actions noprint"><button class="btn small" id="print">Descargar PDF</button> <button class="btn small ghost" id="copy" data-url="${h(url)}">Copiar enlace</button>
<a class="btn small ghost" href="https://wa.me/?text=${encodeURIComponent('Mira lo que he encontrado sobre ' + s.query + ': ' + url)}" target="_blank" rel="noopener">WhatsApp</a></p></section>
<section class="summary"><div class="pills"><span class="p-alerta">${cnt('alerta')} alertas</span><span class="p-atencion">${cnt('atencion')} a revisar</span><span class="p-bien">${cnt('bien')} positivas</span></div>
<p>${h(s.ai || r.summary)}</p>${s.ai ? '<p class="muted small">Resumen redactado con IA a partir de los datos de abajo.</p>' : ''}</section>
${r.signals.length ? `<section><h2>Señales</h2>${r.signals.map(x => `<div class="sig s-${x.level}"><b>${LVL[x.level]}</b><span>${h(x.text)}</span><small>${h(x.source || '')}</small></div>`).join('')}</section>` : ''}
${r.facts.length ? `<section><h2>Datos encontrados</h2>${Object.entries(groups).map(([src, fs]) => `<div class="src"><h3>${h(src)}</h3><table>${fs.map(f => `<tr><td>${h(f.label)}</td><td>${/^https?:\/\//.test(f.value) ? `<a href="${h(f.value)}" target="_blank" rel="noopener nofollow">${h(f.value)}</a>` : h(f.value)}${f.confidence !== 'alta' ? ' <span class="conf">confianza media</span>' : ''}</td><td class="muted small">${f.url ? `<a href="${h(f.url)}" target="_blank" rel="noopener nofollow">ver fuente</a>` : ''}</td></tr>`).join('')}</table></div>`).join('')}</section>` : ''}
${r.sections.map(x => `<section class="box"><h2>${h(x.title)}</h2><p>${h(x.text)}</p>${x.source ? `<p class="small"><a href="${h(x.source)}" target="_blank" rel="noopener">Fuente</a></p>` : ''}</section>`).join('')}
${r.news.length ? `<section><h2>Noticias recientes</h2><ul class="news">${r.news.map(n => `<li><a href="${h(n.url)}" target="_blank" rel="noopener nofollow">${h(n.title)}</a><span class="muted small"> · ${h(n.source)} · ${h(n.date || '')}</span></li>`).join('')}</ul><p class="muted small">Fuente: GDELT. Pueden aparecer homónimos.</p></section>` : ''}
${r.links.length ? `<section class="noprint"><h2>Sigue investigando</h2><div class="links">${r.links.map(l => `<a href="${h(l.url)}" target="_blank" rel="noopener nofollow">${h(l.label)} ↗</a>`).join('')}</div></section>` : ''}
${s.notes ? `<section class="box"><h2>Tus notas</h2><p>${h(s.notes)}</p></section>` : ''}
${r.limits.length ? `<section class="box muted"><h2>Límites de este informe</h2><ul>${r.limits.map(x => `<li>${h(x)}</li>`).join('')}</ul></section>` : ''}
<aside class="cta noprint"><div><h2>¿Te han estafado o quieres revisar algo más a fondo?</h2><p>Técnicos de informática de València te ayudan. Sin compromiso.</p></div><a class="btn" href="${h(CTA_URL)}" target="_blank" rel="noopener">Pedir ayuda</a></aside>
<p class="muted small">Información pública obtenida de forma automática. Puede contener errores u homónimos: compruébala en la fuente antes de tomar decisiones. Este informe no es un juicio sobre nadie.</p>
<script src="/report.js"></script>` });
});

// solicitud de exclusión (derecho de oposición)
app.get('/exclusion', (req, res) => page(res, { title: `Solicitar exclusión · ${NAME}`, body: `<section class="narrow"><h1>Solicitar exclusión</h1><p>Si eres la persona o entidad afectada y no quieres que ${h(NAME)} genere informes sobre ti, indícanos el nombre exacto. Lo bloquearemos.</p>
<form method="post" action="/exclusion" class="stack"><input name="term" required maxlength="120" placeholder="Nombre exacto"><input name="contact" maxlength="120" placeholder="Correo de contacto"><textarea name="reason" maxlength="600" rows="3" placeholder="Motivo (opcional)"></textarea><button class="btn">Enviar</button></form></section>` }));
app.post('/exclusion', limiter, (req, res) => {
  const term = String(req.body.term || '').trim().slice(0, 120);
  if (term.length >= 3) db.prepare('INSERT INTO optout (term, contact, reason) VALUES (?,?,?)').run(term, String(req.body.contact || '').slice(0, 120), String(req.body.reason || '').slice(0, 600));
  page(res, { title: 'Recibido', body: '<section class="narrow"><p class="ok">Recibido. Ya no se generarán informes con ese nombre.</p></section>' });
});

const info = (p, t, html) => app.get(p, (req, res) => page(res, { title: `${t} · ${NAME}`, body: `<section class="narrow prose"><h1>${t}</h1>${html}</section>` }));
info('/uso-responsable', 'Uso responsable', `<p>${h(NAME)} sirve para comprobar si una empresa, web, teléfono o correo es de fiar antes de contratar, pagar o responder. Solo reúne información que ya es pública y la acompaña de su fuente.</p>
<ul><li>No buscamos domicilios, familiares, teléfonos personales ni datos íntimos de particulares.</li><li>No identificamos a personas por fotos ni usamos reconocimiento facial.</li><li>Para personas solo mostramos presencia pública y profesional (cargos, noticias, Wikipedia).</li>
<li>Está prohibido usar la herramienta para acosar, vigilar o discriminar a nadie.</li><li>Cualquier persona o entidad puede <a href="/exclusion">solicitar su exclusión</a>.</li></ul>`);
info('/privacidad', 'Privacidad', `<p>Responsable: ${h(L.name)} (${h(L.email)}).</p><p>Guardamos la consulta y el informe para poder enseñártelo por su enlace. Los informes no se publican ni se indexan en buscadores. Guardamos un identificador anónimo de tu IP del día para evitar abusos.</p>
<p>Los datos de terceros que aparecen en los informes provienen de fuentes públicas (registros, webs de las propias empresas, Wikidata, archivos de noticias). Si apareces en un informe y quieres ejercer tus derechos, escribe a ${h(L.email)} o usa la <a href="/exclusion">solicitud de exclusión</a>.</p><p>No usamos cookies ni analítica de terceros.</p>`);
info('/aviso-legal', 'Aviso legal', `<p>Titular: ${h(L.name)} · NIF ${h(L.nif)} · ${h(L.addr)} · ${h(L.email)}.</p><p>Los informes son automáticos e informativos y pueden contener errores. No constituyen asesoramiento legal ni financiero.</p>`);
app.get('/robots.txt', (req, res) => res.type('text').send(`User-agent: *\nAllow: /\nDisallow: /informe/\nDisallow: /api/\n`));
app.use((req, res) => page(res, { title: 'No encontrado', status: 404, body: `<section class="hero small"><h1>Esta página no existe</h1>${form({ tipo: 'auto' })}</section>` }));
app.use((err, req, res, next) => { console.error(err); res.status(500).send('Algo ha fallado.'); });

const PORT = +(process.env.PORT || 3012);
if (require.main === module) app.listen(PORT, () => console.log(`Investiga en :${PORT} (${SITE})`));
module.exports = app;
