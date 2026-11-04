// Captación de clientes: métricas sin cookies, origen de visitas, avisos por Telegram, formularios "te llamamos" y empresas,
// páginas de captación, guías SEO, recordatorios automáticos y panel de métricas.
const crypto = require('crypto');
const db = require('./db');
const V = require('./views');
const { send, SITE } = require('./mail');
const { CATEGORIES, BARRIOS } = require('./data');
const GUIDES = require('./guides');
const { h } = V;

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
const clean = (s, n) => String(s || '').trim().slice(0, n);
const madrid = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).format(d); // "2026-11-04 09"
const today = () => madrid().slice(0, 10);

// ---------- avisos al administrador: correo + Telegram (opcional) ----------
async function telegram(text) {
  const t = process.env.TELEGRAM_BOT_TOKEN, c = process.env.TELEGRAM_CHAT_ID;
  if (!t || !c) return;
  try {
    await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: c, text: text.slice(0, 4000), disable_web_page_preview: true }), signal: AbortSignal.timeout(8000) });
  } catch (e) { console.error('telegram', e.message); }
}
function notifyAdmin(text, subject) {
  telegram(text);
  if (ADMIN_EMAIL) send(ADMIN_EMAIL, subject || text.split('\n')[0].slice(0, 120), text);
}

// ---------- métricas sin cookies (como Plausible: hash diario de IP+navegador, no se guarda nada personal) ----------
const BOT = /bot|crawl|spider|slurp|preview|monitor|curl|wget|python|headless|lighthouse|facebookexternalhit|whatsapp|telegram/i;
let salt = crypto.randomBytes(16).toString('hex'), saltDay = today(), seen = new Set();
const bump = db.prepare('INSERT INTO pageviews (day,path,n) VALUES (?,?,1) ON CONFLICT(day,path) DO UPDATE SET n=n+1');
const bumpSrc = db.prepare('INSERT INTO sources (day,source,n) VALUES (?,?,1) ON CONFLICT(day,source) DO UPDATE SET n=n+1');
function normPath(p) {
  return p.replace(/^\/trabajo\/\d+.*/, '/trabajo/:id').replace(/^\/profesional\/[^/]+/, '/profesional/:slug').replace(/^\/nueva-clave\/.*/, '/nueva-clave').slice(0, 100);
}
function sourceOf(req) {
  const q = req.query.ref || req.query.utm_source || req.query.src;
  if (q) return clean(q, 40).toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  const r = req.get('referer'); if (!r) return null;
  try {
    const host = new URL(r).hostname.replace(/^www\./, '');
    if (SITE.includes(host)) return null;
    if (/google\./.test(host)) return 'google'; if (/bing\./.test(host)) return 'bing';
    if (/tiktok/.test(host)) return 'tiktok'; if (/youtu/.test(host)) return 'youtube';
    if (/instagram/.test(host)) return 'instagram'; if (/facebook|fb\./.test(host)) return 'facebook';
    if (/whatsapp|wa\.me/.test(host)) return 'whatsapp'; if (/t\.co$|twitter|x\.com/.test(host)) return 'x';
    return host.slice(0, 40);
  } catch { return null; }
}
function track(req, res, next) {
  if (req.method !== 'GET' || /^\/(api|admin)/.test(req.path) || /\.\w+$/.test(req.path)) return next();
  const bot = BOT.test(req.get('user-agent') || ''), d = today();
  const src = sourceOf(req);
  if (src && req.session && req.session.src !== src) { req.session.src = src; if (!bot) try { bumpSrc.run(d, src); } catch {} }
  if (bot) return next();
  if (d !== saltDay) { salt = crypto.randomBytes(16).toString('hex'); saltDay = d; seen = new Set(); }
  try {
    bump.run(d, normPath(req.path));
    const id = crypto.createHash('sha256').update(salt + req.ip + (req.get('user-agent') || '')).digest('hex').slice(0, 16);
    if (!seen.has(id)) { seen.add(id); bump.run(d, '__visitantes'); }
  } catch (e) { console.error('track', e.message); }
  next();
}

// ---------- recordatorios automáticos (cada hora) ----------
function reminders() {
  // 1) cliente con respuestas que no elige en 48 h → recordatorio una vez
  for (const j of db.prepare(`SELECT j.*, u.email, u.name FROM jobs j JOIN users u ON u.id=j.client_id WHERE j.status='abierto' AND j.nudged=0 AND j.hidden=0
      AND j.created_at < datetime('now','-48 hours') AND EXISTS (SELECT 1 FROM responses r WHERE r.job_id=j.id)`).all()) {
    const n = db.prepare('SELECT COUNT(*) n FROM responses WHERE job_id=?').get(j.id).n;
    send(j.email, `Tienes ${n} respuesta${n > 1 ? 's' : ''} esperando: "${j.title}"`, `Hola ${j.name.split(' ')[0]},\n\nTe han escrito ${n} técnico${n > 1 ? 's' : ''}. Puedes preguntarles lo que quieras por el chat antes de elegir.\n\n${SITE}/trabajo/${j.id}\n\nSi ya lo has solucionado, entra y ciérralo para que no te escriban más.`);
    db.prepare('UPDATE jobs SET nudged=1 WHERE id=?').run(j.id);
  }
  // 2) trabajo terminado → pedir valoración a ambos (24 h después)
  for (const j of db.prepare(`SELECT * FROM jobs WHERE status='terminado' AND review_asked=0 AND hidden=0`).all()) {
    for (const [uid, to] of [[j.client_id, j.assigned_to], [j.assigned_to, j.client_id]]) {
      if (db.prepare('SELECT 1 FROM reviews WHERE job_id=? AND from_id=?').get(j.id, uid)) continue;
      const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid); if (!u) continue;
      send(u.email, `¿Qué tal fue "${j.title}"?`, `Hola ${u.name.split(' ')[0]},\n\nTu valoración tarda 10 segundos y ayuda a que los buenos suban en el ranking.\n\n${SITE}/trabajo/${j.id}`);
    }
    db.prepare('UPDATE jobs SET review_asked=1 WHERE id=?').run(j.id);
  }
  // 3) trabajos abiertos de más de 30 días → se cierran solos
  db.prepare(`UPDATE jobs SET status='cerrado' WHERE status='abierto' AND created_at < datetime('now','-30 days')`).run();
  // 4) resumen diario a las 9:00 para técnicos (trabajos nuevos de lo suyo que no han respondido)
  const [d, hour] = madrid().split(' ');
  if (hour === '09' && db.prepare("SELECT v FROM kv WHERE k='digest'").get()?.v !== d) {
    db.prepare("INSERT INTO kv (k,v) VALUES ('digest',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(d);
    const fresh = db.prepare(`SELECT * FROM jobs WHERE status='abierto' AND hidden=0 AND created_at > datetime('now','-24 hours')`).all();
    if (fresh.length) for (const p of db.prepare("SELECT * FROM users WHERE role='profesional' AND hidden=0 AND digest=1").all()) {
      const sk = (p.skills || '').split(',').filter(Boolean);
      const list = fresh.filter(j => (!sk.length || sk.includes(j.category)) && j.client_id !== p.id
        && !db.prepare('SELECT 1 FROM responses WHERE job_id=? AND pro_id=?').get(j.id, p.id));
      if (!list.length) continue;
      send(p.email, `${list.length} trabajo${list.length > 1 ? 's' : ''} nuevo${list.length > 1 ? 's' : ''} en València`, `Hola ${p.name.split(' ')[0]},\n\n${list.map(j => `• ${j.title} (${j.barrio})\n  ${SITE}/trabajo/${j.id}`).join('\n')}\n\nCada uno trae tu respuesta preparada. Responder es gratis.\n\nPara no recibir este resumen, desactívalo en ${SITE}/panel`);
    }
  }
}

// ---------- formularios de captación ----------
function leadForm(req, kind, v = {}, err = '') {
  const emp = kind === 'empresa';
  return `<form method="post" action="/contacto" class="form lead" id="contacto"><input type="hidden" name="_csrf" value="${h(req.session.csrf)}"><input type="hidden" name="kind" value="${kind}">
${err ? `<p class="error">${h(err)}</p>` : ''}<div class="hp" aria-hidden="true"><label>Web<input name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="two"><label>Nombre<input name="name" required maxlength="60" value="${h(v.name || '')}"></label>
<label>Teléfono<input name="phone" type="tel" maxlength="20" ${emp ? '' : 'required'} value="${h(v.phone || '')}" placeholder="6xx xxx xxx"></label></div>
${emp ? `<div class="two"><label>Empresa<input name="company" maxlength="80" required value="${h(v.company || '')}"></label><label>Correo<input name="email" type="email" maxlength="120" required value="${h(v.email || '')}"></label></div>` : ''}
<label>${emp ? '¿Qué necesitáis?' : '¿Qué te pasa?'}<textarea name="message" rows="3" maxlength="1500" required placeholder="${emp ? 'Ej.: somos 8 en la oficina, queremos mantenimiento mensual y copias de seguridad' : 'Ej.: el portátil no enciende'}">${h(v.message || '')}</textarea></label>
<label class="check"><input type="checkbox" name="legal" value="1" required> Acepto que me contactéis por este tema (<a href="/privacidad" target="_blank">privacidad</a>).</label>
<button class="btn">${emp ? 'Pedir propuesta sin compromiso' : 'Que me llamen'}</button></form>`;
}

const PAGE = (title, html) => `<section class="narrow prose"><h1>${title}</h1>${html}</section>`;

function mount(app, { ranking, limiter, needAdmin, csrf }) {
  app.post('/contacto', limiter, (req, res) => {
    const b = req.body, kind = b.kind === 'empresa' ? 'empresa' : 'llamada';
    if (b.website) return res.redirect('/gracias'); // trampa para bots
    const v = { name: clean(b.name, 60), phone: clean(b.phone, 20).replace(/[^\d+ ]/g, ''), email: clean(b.email, 120).toLowerCase(), company: clean(b.company, 80), message: clean(b.message, 1500) };
    const back = e => res.page({ title: 'Revisa el formulario · Trabajillos', body: `<section class="narrow"><h1>Casi está</h1>${leadForm(req, kind, v, e)}</section>` }, 400);
    if (v.name.length < 2 || v.message.length < 5) return back('Pon tu nombre y cuéntanos qué necesitas.');
    if (kind === 'llamada' && v.phone.replace(/\D/g, '').length < 9) return back('Revisa el teléfono.');
    if (kind === 'empresa' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return back('Revisa el correo.');
    if (!b.legal) return back('Tienes que aceptar que te contactemos.');
    const id = db.prepare('INSERT INTO leads (kind,name,phone,email,company,message,source) VALUES (?,?,?,?,?,?,?)')
      .run(kind, v.name, v.phone, v.email, v.company, v.message, req.session.src || null).lastInsertRowid;
    notifyAdmin(`${kind === 'empresa' ? '🏢 EMPRESA' : '📞 LLAMAR'}: ${v.name}${v.company ? ' (' + v.company + ')' : ''}\n${v.phone} ${v.email}\n\n${v.message}\n\nOrigen: ${req.session.src || 'directo'}\n${SITE}/admin/leads#l${id}`);
    res.redirect('/gracias');
  });
  app.get('/gracias', (req, res) => res.page({ title: 'Recibido · Trabajillos', body: `<section class="narrow"><p class="ok big">Recibido. Te contactamos lo antes posible, normalmente el mismo día.</p>
<p>Mientras tanto, si quieres que te escriban varios técnicos y comparar, <a href="/publicar">publícalo gratis aquí</a>.</p></section>` }));

  app.get('/empresas', (req, res) => res.page({ title: 'Informática para empresas en València · Mantenimiento y soporte · Trabajillos', canonical: '/empresas',
    desc: 'Soporte informático para pymes, comercios y despachos de València: mantenimiento, redes, copias de seguridad, ciberseguridad y soporte remoto. Propuesta sin compromiso.',
    body: `<section class="hero small"><div><p class="kicker">Empresas · Autónomos · Comercios</p><h1>Tu informática, en manos de técnicos de València</h1>
<p class="lead">Mantenimiento, redes, correo, copias de seguridad, ciberseguridad y soporte remoto. Cuéntanos qué tenéis y te preparamos una propuesta sin compromiso.</p></div>
<aside class="stats"><div><b>Remoto</b><span>soporte desde el primer día</span></div><div><b>Local</b><span>técnicos en València</span></div></aside></section>
<section class="cols3"><div class="card"><h3>Mantenimiento</h3><p>Equipos actualizados, antivirus, copias revisadas. Un mantenimiento a tiempo cuesta menos que una avería.</p></div>
<div class="card"><h3>Redes y wifi</h3><p>Wifi que llegue a todo el local, red separada para clientes, impresoras compartidas que funcionen.</p></div>
<div class="card"><h3>Seguridad</h3><p>Copias fuera de la oficina, contraseñas y doble factor, formación contra el phishing.</p></div></section>
<section class="narrow"><h2>Pide tu propuesta</h2>${leadForm(req, 'empresa')}</section>` }));

  app.get('/tecnicos', (req, res) => res.page({ title: 'Consigue clientes de informática en València sin pagar por contacto · Trabajillos', canonical: '/tecnicos',
    desc: 'Técnicos y empresas de informática: recibe trabajos de tu barrio con la respuesta ya preparada. Sin cuotas y sin pagar por cada contacto.',
    body: `<section class="hero small"><div><p class="kicker">Para técnicos y empresas de informática</p><h1>Clientes de tu barrio. Sin pagar por cada contacto.</h1>
<p class="lead">En otras plataformas pagas por cada cliente al que escribes, te contrate o no. Aquí responder es gratis.</p>
<p><a class="btn" href="/registro?rol=profesional">Crear mi perfil gratis</a></p></div>
<aside class="stats"><div><b>0 €</b><span>por contacto</span></div><div><b>0 €</b><span>de cuota</span></div></aside></section>
<section class="how"><h2>Qué te llevas</h2><ol><li><b>Avisos de trabajos de lo tuyo</b> en tu barrio, por correo, con un resumen cada mañana.</li>
<li><b>Tu asistente te prepara la respuesta</b> con tu experiencia y el precio orientativo. Revisas y envías.</li>
<li><b>Chat con el cliente</b> y seguimiento de cada trabajo, como un pequeño SAT.</li>
<li><b>Ranking por valoraciones reales.</b> Tu perfil público te sirve de carta de presentación: compártelo.</li></ol></section>` }));

  app.get('/alternativa-cronoshare', (req, res) => res.page({ title: 'Alternativa gratis a Cronoshare para informática en València · Trabajillos', canonical: '/alternativa-cronoshare',
    desc: 'Busca técnico de informática en València sin que los profesionales paguen por contactarte. Comparativa honesta y cómo funciona Trabajillos.',
    body: PAGE('Una alternativa gratis a Cronoshare, solo de informática y solo de València', `<p>Cronoshare, Habitissimo y similares funcionan bien para muchos oficios. Su modelo es que el profesional paga por cada contacto o por suscripción. Eso tiene un efecto: muchos técnicos buenos no responden, porque cada respuesta les cuesta dinero aunque no les contraten.</p>
<p><b>En Trabajillos nadie paga por contactar.</b> Ni tú, ni los técnicos.</p>
<table><tr><th></th><th>Trabajillos</th><th>Plataformas de pago por contacto</th></tr>
<tr><td>Publicar</td><td>Gratis</td><td>Gratis</td></tr><tr><td>El técnico responde</td><td>Gratis</td><td>Paga por contacto o cuota</td></tr>
<tr><td>Especialidad</td><td>Solo informática</td><td>Todos los oficios</td></tr><tr><td>Zona</td><td>València, por barrios</td><td>Toda España</td></tr>
<tr><td>Si nadie responde</td><td>Te respondemos nosotros en 24 h</td><td>Depende</td></tr></table>
<p><a class="btn" href="/publicar">Publicar gratis</a> <a class="btn ghost" href="/tecnicos">Soy técnico</a></p>`) }));

  app.get('/precios', (req, res) => res.page({ title: 'Cuánto cuesta un técnico de informática en València (precios orientativos) · Trabajillos', canonical: '/precios',
    desc: 'Precios orientativos de reparación de ordenadores, eliminar virus, wifi, recuperar datos, montar PC y webs en València.',
    jsonld: { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: Object.values(CATEGORIES).map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name })) },
    body: PAGE('¿Cuánto cuesta un técnico de informática en València?', `<p>Son rangos orientativos para trabajos habituales. Cada técnico te da su precio antes de empezar, y depende del problema, las piezas y si es presencial o remoto.</p>
<table><tr><th>Servicio</th><th>Precio orientativo</th></tr>${Object.entries(CATEGORIES).map(([k, c]) => `<tr><td><a href="/servicios/${k}">${h(c.name)}</a></td><td>${c.price[0]}–${c.price[1]} €</td></tr>`).join('')}</table>
<h2>Consejos para no pagar de más</h2><ul><li>Pide que te digan el precio <b>antes</b> de empezar.</li><li>Pregunta si cobran desplazamiento y diagnóstico aparte.</li><li>Muchas cosas (virus, configuración, programas) se arreglan en remoto y salen más baratas.</li><li>Compara: publica gratis y te escriben varios.</li></ul>
<p><a class="btn" href="/publicar">Pedir presupuestos gratis</a></p>`) }));

  app.get('/guias', (req, res) => res.page({ title: 'Guías de informática y seguridad · Trabajillos', canonical: '/guias',
    desc: 'Guías prácticas: estafas por teléfono y SMS, ordenador lento, wifi, recuperar fotos y cuentas robadas.',
    body: `<h1>Guías</h1><p class="lead">Lo que más nos preguntan, explicado sin tecnicismos.</p><div class="grid">${GUIDES.map(g => `<a class="card" href="/guias/${g.slug}"><h3>${h(g.title)}</h3><p class="muted">${h(g.desc)}</p></a>`).join('')}</div>` }));
  app.get('/guias/:slug', (req, res, next) => {
    const g = GUIDES.find(x => x.slug === req.params.slug); if (!g) return next();
    const c = CATEGORIES[g.cat];
    res.page({ title: `${g.title} · Trabajillos`, desc: g.desc, canonical: `/guias/${g.slug}`,
      jsonld: { '@context': 'https://schema.org', '@type': 'Article', headline: g.title, description: g.desc, publisher: { '@type': 'Organization', name: 'Trabajillos' } },
      body: `<article class="narrow prose"><p class="kicker"><a href="/guias">Guías</a></p><h1>${h(g.title)}</h1>${g.body}
<aside class="box cta"><h2>¿Prefieres que lo mire alguien?</h2><p>Técnicos de ${h(c.short.toLowerCase())} en València te escriben gratis. Precio orientativo: ${c.price[0]}–${c.price[1]} €.</p>
<p><a class="btn" href="/publicar?q=${encodeURIComponent(g.title)}">Publicar gratis</a> <a class="btn ghost" href="#contacto">Que me llamen</a></p></aside>
<section><h2>Te llamamos</h2>${leadForm(req, 'llamada')}</section>${share(SITE + '/guias/' + g.slug, g.title)}</article>` });
  });

  // ---------- administración: contactos y métricas ----------
  app.get('/admin/leads', needAdmin, (req, res) => {
    const leads = db.prepare('SELECT * FROM leads ORDER BY id DESC LIMIT 200').all();
    const ST = ['nuevo', 'contactado', 'cliente', 'descartado'];
    res.page({ title: 'Contactos · Admin', body: `<h1>Contactos (${leads.length})</h1><p><a href="/admin">← Admin</a> · <a href="/admin/metricas">Métricas</a></p>
${leads.map(l => `<div class="card" id="l${l.id}"><div class="row"><b>${l.kind === 'empresa' ? '🏢' : '📞'} ${h(l.name)}${l.company ? ' · ' + h(l.company) : ''}</b><span class="tk tk-${l.status}">${l.status}</span></div>
<p>${l.phone ? `<a href="tel:${h(l.phone.replace(/\s/g, ''))}">${h(l.phone)}</a> · <a href="https://wa.me/${h(l.phone.replace(/\D/g, '').replace(/^(\d{9})$/, '34$1'))}">WhatsApp</a>` : ''} ${l.email ? `· <a href="mailto:${h(l.email)}">${h(l.email)}</a>` : ''}</p>
<p>${h(l.message)}</p><p class="muted small">${V.ago(l.created_at)} · origen: ${h(l.source || 'directo')}</p>
<form method="post" action="/admin/leads/${l.id}" class="inline">${csrf(req)}${ST.filter(s => s !== l.status).map(s => `<button class="btn small ghost" name="status" value="${s}">${s}</button>`).join(' ')}</form></div>`).join('') || '<p class="muted">Aún no hay contactos.</p>'}` });
  });
  app.post('/admin/leads/:id', needAdmin, (req, res) => {
    if (['nuevo', 'contactado', 'cliente', 'descartado'].includes(req.body.status)) db.prepare('UPDATE leads SET status=? WHERE id=?').run(req.body.status, req.params.id);
    res.redirect('/admin/leads#l' + parseInt(req.params.id, 10));
  });
  app.get('/admin/metricas', needAdmin, (req, res) => {
    const days = db.prepare(`SELECT day, SUM(CASE WHEN path='__visitantes' THEN n ELSE 0 END) v, SUM(CASE WHEN path!='__visitantes' THEN n ELSE 0 END) pv
      FROM pageviews WHERE day >= date('now','-30 days') GROUP BY day ORDER BY day`).all();
    const top = db.prepare(`SELECT path, SUM(n) n FROM pageviews WHERE day >= date('now','-30 days') AND path!='__visitantes' GROUP BY path ORDER BY n DESC LIMIT 20`).all();
    const src = db.prepare(`SELECT source, SUM(n) n FROM sources WHERE day >= date('now','-30 days') GROUP BY source ORDER BY n DESC LIMIT 15`).all();
    const q = s => db.prepare(s).get().n;
    const f = [['Visitantes (30 días)', days.reduce((a, d) => a + d.v, 0)],
      ['Clientes registrados', q("SELECT COUNT(*) n FROM users WHERE role='cliente'")], ['Técnicos registrados', q("SELECT COUNT(*) n FROM users WHERE role='profesional'")],
      ['Contactos (te llamamos/empresas)', q('SELECT COUNT(*) n FROM leads')], ['Trabajos publicados', q('SELECT COUNT(*) n FROM jobs')],
      ['Con al menos una respuesta', q('SELECT COUNT(DISTINCT job_id) n FROM responses')], ['Asignados', q("SELECT COUNT(*) n FROM jobs WHERE assigned_to IS NOT NULL")],
      ['Terminados', q("SELECT COUNT(*) n FROM jobs WHERE status='terminado'")], ['Valoraciones', q('SELECT COUNT(*) n FROM reviews')]];
    const bySrc = db.prepare(`SELECT COALESCE(source,'directo') s, COUNT(*) n FROM users GROUP BY s ORDER BY n DESC`).all();
    const max = Math.max(1, ...days.map(d => d.pv));
    res.page({ title: 'Métricas · Admin', body: `<h1>Métricas</h1><p><a href="/admin">← Admin</a> · <a href="/admin/leads">Contactos</a></p>
<section class="box"><h2>Embudo</h2><table>${f.map(([k, v]) => `<tr><td>${k}</td><td><b>${v}</b></td></tr>`).join('')}</table></section>
<section><h2>Visitas por día (30 días)</h2><div class="bars">${days.map(d => `<div title="${d.day}: ${d.v} visitantes, ${d.pv} páginas"><span class="h${Math.round(d.pv / max * 20) * 5}"></span><i>${d.day.slice(8)}</i></div>`).join('') || '<p class="muted">Sin datos todavía.</p>'}</div>
<p class="muted small">Sin cookies: cada visitante se cuenta una vez al día con un identificador anónimo que se borra a medianoche.</p></section>
<div class="two"><section><h2>Páginas más vistas</h2><table>${top.map(t => `<tr><td>${h(t.path)}</td><td>${t.n}</td></tr>`).join('')}</table></section>
<section><h2>De dónde vienen</h2><table>${src.map(s => `<tr><td>${h(s.source)}</td><td>${s.n}</td></tr>`).join('') || '<tr><td class="muted">Usa enlaces con ?ref=tiktok, ?ref=youtube…</td></tr>'}</table>
<h3>Registros por origen</h3><table>${bySrc.map(s => `<tr><td>${h(s.s)}</td><td>${s.n}</td></tr>`).join('')}</table></section></div>` });
  });
}

function share(url, text) {
  const u = encodeURIComponent(url), t = encodeURIComponent(text);
  return `<p class="share">Compartir: <a href="https://wa.me/?text=${t}%20${u}" rel="noopener" target="_blank">WhatsApp</a> · <a href="https://t.me/share/url?url=${u}&text=${t}" rel="noopener" target="_blank">Telegram</a> · <a href="https://www.facebook.com/sharer/sharer.php?u=${u}" rel="noopener" target="_blank">Facebook</a> · <a href="https://twitter.com/intent/tweet?url=${u}&text=${t}" rel="noopener" target="_blank">X</a></p>`;
}

module.exports = { mount, track, reminders, notifyAdmin, leadForm, share, GUIDES };
