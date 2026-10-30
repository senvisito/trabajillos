const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const { send, SITE } = require('./mail');
const A = require('./assistant');
const V = require('./views');
const { CATEGORIES, BARRIOS, slugify } = require('./data');
const { h, layout } = V;

for (const col of ['reset_token TEXT', 'reset_exp INTEGER']) { try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch {} }

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'],
  scriptSrc: ["'self'"], imgSrc: ["'self'", 'data:'], formAction: ["'self'"] } } }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(express.json({ limit: '20kb' }));
app.use(cookieSession({ name: 'tj', keys: [process.env.SESSION_SECRET || 'dev-secret-cambiar'], maxAge: 30 * 864e5,
  sameSite: 'lax', httpOnly: true, secure: SITE.startsWith('https') }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1d' }));

// Usuario y token CSRF en cada petición
app.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(16).toString('hex');
  req.user = req.session.uid ? db.prepare('SELECT * FROM users WHERE id=? AND hidden=0').get(req.session.uid) : null;
  res.page = (o, status = 200) => res.status(status).send(layout({ ...o, user: req.user, csrf: req.session.csrf }));
  if (req.method === 'POST') {
    const t = req.body?._csrf || req.get('x-csrf');
    if (!t || t !== req.session.csrf) return res.status(403).send('Sesión caducada. Vuelve atrás y recarga la página.');
  }
  next();
});
const csrf = req => `<input type="hidden" name="_csrf" value="${h(req.session.csrf)}">`;
const needUser = (req, res, next) => req.user ? next() : res.redirect('/entrar?next=' + encodeURIComponent(req.originalUrl));
const limiter = rateLimit({ windowMs: 15 * 60e3, limit: 30, standardHeaders: true, legacyHeaders: false });
const clean = (s, n) => String(s || '').trim().slice(0, n);
const int = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 && n < 100000 ? n : null; };

// ---------- consultas comunes ----------
const proStats = db.prepare(`SELECT u.*, COALESCE(AVG(r.rating),0) avg, COUNT(r.id) n_rev,
  (SELECT COUNT(*) FROM jobs j WHERE j.assigned_to=u.id AND j.status='terminado') done
  FROM users u LEFT JOIN reviews r ON r.to_id=u.id AND r.hidden=0 WHERE u.role='profesional' AND u.hidden=0 GROUP BY u.id`);
function ranking(cat) {
  return proStats.all().filter(p => !cat || (p.skills || '').split(',').includes(cat))
    .map(p => ({ ...p, score: A.rankScore(p.avg, p.n_rev, p.done) })).sort((a, b) => b.score - a.score);
}
const jobsQ = (where, args = [], limit = 30) => db.prepare(`SELECT j.*, (SELECT COUNT(*) FROM responses r WHERE r.job_id=j.id) n_resp
  FROM jobs j WHERE j.hidden=0 ${where} ORDER BY j.created_at DESC LIMIT ${limit}`).all(...args);

async function createUser({ email, pass, name, role, barrio, phone, skills }) {
  const base = slugify(name) || 'usuario'; let slug = base, i = 1;
  while (db.prepare('SELECT 1 FROM users WHERE slug=?').get(slug)) slug = `${base}-${++i}`;
  const hash = await bcrypt.hash(pass, 10);
  const info = db.prepare(`INSERT INTO users (email,pass,name,slug,role,barrio,phone,skills,is_admin) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(email, hash, name, slug, role, barrio, phone, skills || '', email === ADMIN_EMAIL ? 1 : 0);
  return info.lastInsertRowid;
}
function validSignup(b) {
  const email = clean(b.email, 120).toLowerCase(), name = clean(b.name, 60), pass = String(b.pass || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { err: 'Revisa el correo.' };
  if (name.length < 2) return { err: 'Pon tu nombre.' };
  if (pass.length < 8) return { err: 'La contraseña debe tener al menos 8 caracteres.' };
  if (!b.legal) return { err: 'Tienes que aceptar las condiciones y la política de privacidad.' };
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return { err: 'Ya hay una cuenta con ese correo. Entra con tu contraseña.' };
  return { email, name, pass };
}

// ---------- notificaciones ----------
function notifyNewJob(job) {
  send(ADMIN_EMAIL, `Nuevo trabajo: ${job.title}`, `${job.title}\n${job.barrio} · ${CATEGORIES[job.category].name}\n\n${job.description}\n\n${SITE}/trabajo/${job.id}`);
  const pros = ranking(job.category).slice(0, 10);
  for (const p of pros) send(p.email, `Trabajo nuevo para ti en ${job.barrio}`,
    `Hola ${p.name},\n\nHay un trabajo que encaja contigo:\n"${job.title}" (${job.barrio}).\n\nTu asistente ya te ha preparado una respuesta. Entra y envíala en 10 segundos:\n${SITE}/trabajo/${job.id}`);
}
setInterval(() => {   // garantía de respuesta: aviso al administrador si un trabajo lleva 24 h sin respuestas
  const late = db.prepare(`SELECT * FROM jobs j WHERE status='abierto' AND alerted=0 AND hidden=0 AND created_at < datetime('now','-24 hours')
    AND NOT EXISTS (SELECT 1 FROM responses r WHERE r.job_id=j.id)`).all();
  for (const j of late) {
    send(ADMIN_EMAIL, `⚠ 24 h sin respuesta: ${j.title}`, `Nadie ha respondido todavía. Respóndelo tú:\n${SITE}/trabajo/${j.id}`);
    db.prepare('UPDATE jobs SET alerted=1 WHERE id=?').run(j.id);
  }
}, 60 * 60e3).unref();

// ---------- portada ----------
app.get('/', (req, res) => {
  const jobs = jobsQ("AND j.status='abierto'", [], 6);
  const top = ranking().slice(0, 4);
  const n = db.prepare("SELECT (SELECT COUNT(*) FROM jobs) j, (SELECT COUNT(*) FROM users WHERE role='profesional') p").get();
  res.page({ title: 'Trabajillos · Encuentra quien te arregle el ordenador en València, gratis', canonical: '/',
    desc: 'Cuenta qué te pasa con el ordenador, el wifi o la web y te contactan técnicos de València. Gratis para todos: nadie paga por contactar.',
    body: `<section class="hero">
  <div><p class="kicker">Informática · València</p>
  <h1>Cuéntanos qué te pasa con el ordenador. <span>Te escriben técnicos de tu barrio.</span></h1>
  <p class="lead">Gratis para ti y gratis para ellos. Aquí nadie paga por contactar, así que contestan más y antes.</p>
  <form class="quick" method="get" action="/publicar"><textarea name="q" rows="3" maxlength="1500" placeholder="Ej.: Mi portátil HP va lentísimo desde ayer y me salen anuncios raros" required></textarea>
  <button class="btn">Publicar gratis</button></form>
  <p class="muted small">Respuesta garantizada: si en 24 h nadie te contesta, te contestamos nosotros.</p></div>
  <aside class="stats"><div><b>0 €</b><span>por contactar</span></div><div><b>${n.p}</b><span>profesionales</span></div><div><b>${n.j}</b><span>trabajos publicados</span></div></aside>
</section>
<section><div class="row"><h2>Trabajos recientes</h2><a href="/trabajos">Ver todos →</a></div>
<div class="grid">${jobs.map(V.jobCard).join('') || '<p class="empty">Todavía no hay trabajos. ¡Publica el primero!</p>'}</div></section>
<section><div class="row"><h2>Mejor valorados</h2><a href="/ranking">Ver ranking →</a></div>
<div class="grid">${top.map((p, i) => V.proCard(p, i)).join('') || '<p class="empty">¿Eres técnico? <a href="/registro?rol=profesional">Crea tu perfil gratis</a> y aparece aquí.</p>'}</div></section>
<section class="how"><h2>Así de fácil</h2><ol>
<li><b>Lo cuentas con tus palabras.</b> El asistente lo ordena, te dice cuánto suele costar y qué detalles faltan.</li>
<li><b>Te escriben técnicos.</b> Ves su valoración, sus trabajos y su precio antes de decidir.</li>
<li><b>Eliges y valoras.</b> Tu reseña ayuda a los demás y sube a los buenos en el ranking.</li></ol>
<p><a class="btn ghost" href="/registro?rol=profesional">Soy técnico: quiero trabajos gratis</a></p></section>` });
});

// ---------- asistente (cliente) ----------
app.post('/api/asistente', limiter, async (req, res) => {
  const text = clean(req.body.text, 1500);
  if (text.length < 10) return res.json({ ok: false });
  const r = A.analyzeRequest(text);
  res.json({ ok: true, ...r });
});

// ---------- publicar ----------
function publishForm(req, v = {}, err = '') {
  return `<section class="narrow"><h1>Publica tu trabajo gratis</h1>
<p class="lead">Escríbelo como se lo contarías a un amigo. El asistente te ayuda a completarlo.</p>
${err ? `<p class="error">${h(err)}</p>` : ''}
<form method="post" action="/publicar" class="form" id="pubform">${csrf(req)}
<label>¿Qué necesitas?<textarea name="description" id="desc" rows="5" maxlength="3000" required>${h(v.description || v.q || '')}</textarea></label>
<div id="assist" class="assist" hidden></div>
<label>Título<input name="title" id="title" maxlength="90" required value="${h(v.title || '')}"></label>
<div class="two"><label>Tipo<select name="category" id="category">${V.catOptions(v.category)}</select></label>
<label>Barrio<select name="barrio" required><option value="">Elige tu barrio</option>${V.barrioOptions(v.barrio)}</select></label></div>
<div class="two"><label>¿Presencial o remoto?<select name="modality" id="modality"><option value="presencial">Presencial</option><option value="remoto"${v.modality === 'remoto' ? ' selected' : ''}>Remoto</option><option value="ambos">Me da igual</option></select></label>
<label>¿Para cuándo?<select name="urgency" id="urgency"><option value="normal">Esta semana</option><option value="urgente"${v.urgency === 'urgente' ? ' selected' : ''}>Urgente</option><option value="sin prisa">Sin prisa</option></select></label></div>
<div class="two"><label>Presupuesto mínimo (€)<input name="budget_min" id="bmin" inputmode="numeric" value="${h(v.budget_min || '')}"></label>
<label>Presupuesto máximo (€)<input name="budget_max" id="bmax" inputmode="numeric" value="${h(v.budget_max || '')}"></label></div>
${req.user ? '' : `<fieldset><legend>Tus datos (para que te avisemos de las respuestas)</legend>
<label>Nombre<input name="name" required maxlength="60" value="${h(v.name || '')}"></label>
<label>Correo<input name="email" type="email" required maxlength="120" value="${h(v.email || '')}"></label>
<label>Contraseña (mín. 8)<input name="pass" type="password" required minlength="8"></label>
<label class="check"><input type="checkbox" name="legal" value="1" required> Acepto las <a href="/condiciones" target="_blank">condiciones</a> y la <a href="/privacidad" target="_blank">privacidad</a>.</label></fieldset>`}
<p class="muted small">Tu correo y teléfono no se publican. Solo los verá el técnico que elijas.</p>
<button class="btn">Publicar gratis</button></form></section><script src="/app.js"></script>`;
}
app.get('/publicar', (req, res) => res.page({ title: 'Publicar un trabajo gratis · Trabajillos', canonical: '/publicar', body: publishForm(req, { q: clean(req.query.q, 1500) }) }));
app.post('/publicar', limiter, async (req, res) => {
  const b = req.body;
  const v = { description: clean(b.description, 3000), title: clean(b.title, 90), category: b.category, barrio: b.barrio,
    modality: ['presencial', 'remoto', 'ambos'].includes(b.modality) ? b.modality : 'presencial',
    urgency: ['urgente', 'normal', 'sin prisa'].includes(b.urgency) ? b.urgency : 'normal',
    budget_min: int(b.budget_min), budget_max: int(b.budget_max), name: b.name, email: b.email };
  const fail = e => res.page({ title: 'Publicar · Trabajillos', body: publishForm(req, v, e) }, 400);
  if (v.description.length < 20) return fail('Cuéntanos un poco más (mínimo 20 caracteres).');
  if (v.title.length < 5) return fail('Ponle un título.');
  if (!CATEGORIES[v.category] || !BARRIOS.includes(v.barrio)) return fail('Elige tipo y barrio.');
  let uid = req.user?.id;
  if (!uid) {
    const s = validSignup(b); if (s.err) return fail(s.err);
    uid = await createUser({ ...s, role: 'cliente', barrio: v.barrio });
    req.session.uid = uid;
  }
  const info = db.prepare(`INSERT INTO jobs (client_id,title,description,category,barrio,modality,urgency,budget_min,budget_max) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(uid, v.title, v.description, v.category, v.barrio, v.modality, v.urgency, v.budget_min, v.budget_max);
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(info.lastInsertRowid);
  notifyNewJob(job);
  res.redirect(`/trabajo/${job.id}?nuevo=1`);
});

// ---------- listado ----------
app.get('/trabajos', (req, res) => {
  const cat = CATEGORIES[req.query.cat] ? req.query.cat : '', barrio = BARRIOS.includes(req.query.barrio) ? req.query.barrio : '';
  const where = []; const args = [];
  if (cat) { where.push('AND j.category=?'); args.push(cat); }
  if (barrio) { where.push('AND j.barrio=?'); args.push(barrio); }
  const jobs = jobsQ(where.join(' '), args, 60);
  res.page({ title: 'Trabajos de informática en València · Trabajillos', canonical: '/trabajos', body: `<h1>Trabajos de informática en València</h1>
<form class="filters" method="get"><select name="cat"><option value="">Todos los tipos</option>${V.catOptions(cat)}</select>
<select name="barrio"><option value="">Todos los barrios</option>${V.barrioOptions(barrio)}</select><button class="btn small">Filtrar</button></form>
<div class="grid">${jobs.map(V.jobCard).join('') || '<p class="empty">No hay trabajos con estos filtros.</p>'}</div>` });
});

// ---------- detalle de trabajo ----------
app.get('/trabajo/:id', (req, res) => {
  const j = db.prepare('SELECT j.*, u.name cname, u.email cemail, u.phone cphone, u.id cid FROM jobs j JOIN users u ON u.id=j.client_id WHERE j.id=? AND j.hidden=0').get(req.params.id);
  if (!j) return res.page({ title: 'No encontrado', body: '<h1>Este trabajo no existe o se ha retirado.</h1>' }, 404);
  const me = req.user, owner = me && me.id === j.client_id, isPro = me && me.role === 'profesional';
  const resp = db.prepare(`SELECT r.*, u.name, u.slug, u.email, u.phone, u.barrio FROM responses r JOIN users u ON u.id=r.pro_id WHERE r.job_id=? ORDER BY r.created_at`).all(j.id);
  const stats = Object.fromEntries(proStats.all().map(p => [p.id, p]));
  const mine = isPro && resp.find(r => r.pro_id === me.id);
  const assignedPro = j.assigned_to && stats[j.assigned_to];
  const reviewed = me && db.prepare('SELECT 1 FROM reviews WHERE job_id=? AND from_id=?').get(j.id, me.id);
  const canReview = me && j.status === 'terminado' && !reviewed && (owner || me.id === j.assigned_to);
  // valoración del cliente: solo visible para profesionales registrados y de forma agregada
  const crate = isPro && db.prepare('SELECT AVG(rating) a, COUNT(*) n FROM reviews WHERE to_id=? AND hidden=0').get(j.client_id);
  let body = `${req.query.nuevo ? `<p class="ok">¡Publicado! Te avisaremos por correo cuando te escriban. Mientras tanto, invita a los mejor valorados:</p>` : ''}
<article class="detail"><div class="meta"><span class="pill">${h(CATEGORIES[j.category].name)}</span>${j.urgency === 'urgente' ? '<span class="pill hot">Urgente</span>' : ''}<span class="status s-${j.status}">${j.status}</span></div>
<h1>${h(j.title)}</h1><p class="muted">${h(j.barrio)} · ${h(j.modality)} · publicado ${V.ago(j.created_at)} por ${h(j.cname.split(' ')[0])}</p>
<p class="desc">${h(j.description).replace(/\n/g, '<br>')}</p><p><b>Presupuesto:</b> ${V.money(j)}</p>
${crate && crate.n ? `<p class="muted small">Valoración de este cliente por otros profesionales: ${V.stars(crate.a)} (${crate.n})</p>` : ''}</article>`;

  if (owner && j.status === 'abierto') {
    const invited = new Set(db.prepare('SELECT pro_id FROM invites WHERE job_id=?').all(j.id).map(x => x.pro_id));
    const best = ranking(j.category).filter(p => !invited.has(p.id) && !resp.some(r => r.pro_id === p.id)).slice(0, 3);
    if (best.length) body += `<section class="box"><h2>Tu asistente te recomienda</h2><div class="grid">${best.map(p => V.proCard(p)).join('')}</div>
<form method="post" action="/trabajo/${j.id}/invitar">${csrf(req)}<button class="btn">Pedirles presupuesto a los ${best.length}</button></form></section>`;
  }
  if (owner || (me && me.is_admin)) {
    body += `<section><h2>Respuestas (${resp.length})</h2>${resp.map(r => {
      const s = stats[r.pro_id] || {};
      return `<div class="card resp"><div class="row"><a href="/profesional/${h(r.slug)}"><b>${h(r.name)}</b></a><span>${s.n_rev ? V.stars(s.avg) + ' ' + s.avg.toFixed(1) : 'Nuevo'} · ${s.done || 0} trabajos</span></div>
<p>${h(r.message)}</p>${r.price ? `<p><b>${r.price} €</b> aprox.</p>` : ''}
${j.status === 'abierto' && owner ? `<form method="post" action="/trabajo/${j.id}/aceptar/${r.pro_id}">${csrf(req)}<button class="btn small">Elegir a ${h(r.name.split(' ')[0])}</button></form>` : ''}
${j.assigned_to === r.pro_id ? `<p class="ok">Elegido. Contacto: ${h(r.email)}${r.phone ? ' · ' + h(r.phone) : ''}</p>` : ''}</div>`;
    }).join('') || '<p class="muted">Todavía nadie ha respondido. Te avisamos por correo.</p>'}</section>`;
  }
  if (isPro && !owner) {
    if (mine) body += `<p class="ok">Ya respondiste a este trabajo.${j.assigned_to === me.id ? ` ¡Te han elegido! Contacto del cliente: ${h(j.cemail)}${j.cphone ? ' · ' + h(j.cphone) : ''}` : ''}</p>`;
    else if (j.status === 'abierto') {
      const draft = A.draftReply(j, me, stats[me.id]);
      body += `<section class="box"><h2>Responder gratis</h2><p class="muted small">Tu asistente ha preparado este mensaje con tus datos. Cámbialo si quieres.</p>
<form method="post" action="/trabajo/${j.id}/responder" class="form">${csrf(req)}<textarea name="message" rows="4" maxlength="1500" required>${h(draft)}</textarea>
<label>Precio orientativo (€)<input name="price" inputmode="numeric" value="${j.budget_max || ''}"></label><button class="btn">Enviar respuesta</button></form></section>`;
    }
  } else if (!me && j.status === 'abierto') body += `<p class="box">¿Eres técnico? <a href="/registro?rol=profesional&next=/trabajo/${j.id}">Crea tu perfil gratis</a> y responde a este trabajo sin pagar nada.</p>`;

  if ((owner || (me && me.id === j.assigned_to)) && j.status === 'asignado')
    body += `<form method="post" action="/trabajo/${j.id}/terminar" class="box">${csrf(req)}<p>¿Ya está hecho?</p><button class="btn">Marcar como terminado</button></form>`;
  if (canReview) body += `<section class="box"><h2>Valora a ${owner ? h(assignedPro?.name || 'el profesional') : 'este cliente'}</h2>
<form method="post" action="/trabajo/${j.id}/resena" class="form">${csrf(req)}<div class="rate">${[5, 4, 3, 2, 1].map(n => `<label><input type="radio" name="rating" value="${n}" required> ${'★'.repeat(n)}</label>`).join('')}</div>
<textarea name="text" rows="3" maxlength="800" placeholder="${owner ? '¿Qué tal el trabajo?' : 'Solo lo verán otros profesionales, de forma agregada.'}"></textarea><button class="btn">Enviar valoración</button></form></section>`;
  body += `<details class="report"><summary>Denunciar este anuncio</summary><form method="post" action="/denunciar" class="form">${csrf(req)}<input type="hidden" name="kind" value="job"><input type="hidden" name="target" value="${j.id}"><textarea name="reason" rows="2" maxlength="500" required placeholder="¿Qué problema hay?"></textarea><button class="btn small ghost">Enviar</button></form></details>`;
  res.page({ title: `${j.title} · ${j.barrio} · Trabajillos`, desc: j.description.slice(0, 155), canonical: `/trabajo/${j.id}`, body });
});

const ownJob = (req, res) => {
  const j = db.prepare('SELECT * FROM jobs WHERE id=? AND hidden=0').get(req.params.id);
  if (!j) { res.status(404).send('No encontrado'); return null; } return j;
};
app.post('/trabajo/:id/responder', needUser, limiter, (req, res) => {
  const j = ownJob(req, res); if (!j) return;
  if (req.user.role !== 'profesional' || j.client_id === req.user.id || j.status !== 'abierto') return res.redirect(`/trabajo/${j.id}`);
  const msg = clean(req.body.message, 1500); if (msg.length < 10) return res.redirect(`/trabajo/${j.id}`);
  try { db.prepare('INSERT INTO responses (job_id,pro_id,message,price) VALUES (?,?,?,?)').run(j.id, req.user.id, msg, int(req.body.price)); } catch {}
  const c = db.prepare('SELECT * FROM users WHERE id=?').get(j.client_id);
  send(c.email, `${req.user.name} ha respondido a "${j.title}"`, `Hola ${c.name},\n\n${req.user.name} te ha escrito:\n"${msg}"\n\nMira su perfil y elige:\n${SITE}/trabajo/${j.id}`);
  res.redirect(`/trabajo/${j.id}`);
});
app.post('/trabajo/:id/aceptar/:pro', needUser, (req, res) => {
  const j = ownJob(req, res); if (!j) return;
  const r = db.prepare('SELECT * FROM responses WHERE job_id=? AND pro_id=?').get(j.id, req.params.pro);
  if (j.client_id !== req.user.id || j.status !== 'abierto' || !r) return res.redirect(`/trabajo/${j.id}`);
  db.prepare("UPDATE jobs SET status='asignado', assigned_to=? WHERE id=?").run(r.pro_id, j.id);
  const p = db.prepare('SELECT * FROM users WHERE id=?').get(r.pro_id);
  send(p.email, `¡Te han elegido para "${j.title}"!`, `Contacto del cliente: ${req.user.name} · ${req.user.email}${req.user.phone ? ' · ' + req.user.phone : ''}\n\n${SITE}/trabajo/${j.id}`);
  res.redirect(`/trabajo/${j.id}`);
});
app.post('/trabajo/:id/terminar', needUser, (req, res) => {
  const j = ownJob(req, res); if (!j) return;
  if ((j.client_id === req.user.id || j.assigned_to === req.user.id) && j.status === 'asignado') db.prepare("UPDATE jobs SET status='terminado' WHERE id=?").run(j.id);
  res.redirect(`/trabajo/${j.id}`);
});
app.post('/trabajo/:id/resena', needUser, (req, res) => {
  const j = ownJob(req, res); if (!j) return;
  const rating = int(req.body.rating);
  if (j.status !== 'terminado' || !rating || rating > 5) return res.redirect(`/trabajo/${j.id}`);
  const to = req.user.id === j.client_id ? j.assigned_to : req.user.id === j.assigned_to ? j.client_id : null;
  if (to) try { db.prepare('INSERT INTO reviews (job_id,from_id,to_id,rating,text) VALUES (?,?,?,?,?)').run(j.id, req.user.id, to, rating, clean(req.body.text, 800)); } catch {}
  res.redirect(`/trabajo/${j.id}`);
});
app.post('/trabajo/:id/invitar', needUser, (req, res) => {
  const j = ownJob(req, res); if (!j) return;
  if (j.client_id !== req.user.id || j.status !== 'abierto') return res.redirect(`/trabajo/${j.id}`);
  for (const p of ranking(j.category).slice(0, 3)) {
    try { db.prepare('INSERT INTO invites (job_id,pro_id) VALUES (?,?)').run(j.id, p.id); } catch { continue; }
    send(p.email, `${req.user.name.split(' ')[0]} te pide presupuesto`, `Te han invitado a "${j.title}" (${j.barrio}).\nTu respuesta ya está preparada:\n${SITE}/trabajo/${j.id}`);
  }
  res.redirect(`/trabajo/${j.id}`);
});

// ---------- ranking y perfiles ----------
app.get('/ranking', (req, res) => {
  const cat = CATEGORIES[req.query.cat] ? req.query.cat : '';
  const list = ranking(cat).slice(0, 50);
  res.page({ title: `Ranking de técnicos de informática en València${cat ? ' · ' + CATEGORIES[cat].short : ''} · Trabajillos`, canonical: '/ranking' + (cat ? `?cat=${cat}` : ''),
    body: `<h1>Los mejores técnicos de informática de València</h1><p class="lead">Ordenados por valoraciones reales de clientes y trabajos terminados. No se puede pagar para subir.</p>
<form class="filters" method="get"><select name="cat"><option value="">Todas las especialidades</option>${V.catOptions(cat)}</select><button class="btn small">Ver</button></form>
<div class="grid">${list.map((p, i) => V.proCard(p, i)).join('') || '<p class="empty">Aún no hay profesionales. <a href="/registro?rol=profesional">Sé el primero</a>.</p>'}</div>` });
});
app.get('/profesional/:slug', (req, res) => {
  const all = ranking(); const i = all.findIndex(p => p.slug === req.params.slug);
  if (i < 0) return res.page({ title: 'No encontrado', body: '<h1>Perfil no encontrado.</h1>' }, 404);
  const p = all[i];
  const revs = db.prepare(`SELECT r.*, u.name FROM reviews r JOIN users u ON u.id=r.from_id WHERE r.to_id=? AND r.hidden=0 ORDER BY r.created_at DESC LIMIT 30`).all(p.id);
  const skills = (p.skills || '').split(',').filter(k => CATEGORIES[k]);
  res.page({ title: `${p.name} · Técnico de informática en ${p.barrio || 'València'} · Trabajillos`, canonical: `/profesional/${p.slug}`,
    desc: `${p.name}: ${p.n_rev} valoraciones, ${p.done} trabajos. ${clean(p.bio, 120)}`,
    jsonld: { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: p.name, areaServed: 'València',
      ...(p.n_rev ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.avg.toFixed(1), reviewCount: p.n_rev } } : {}) },
    body: `<article class="detail"><p class="kicker">Puesto ${i + 1} del ranking de València</p><h1>${h(p.name)}</h1>
<p class="muted">${h(p.barrio || 'València')}${p.remote ? ' · también en remoto' : ''} · ${p.done} trabajos terminados</p>
<p class="stars big">${p.n_rev ? `${V.stars(p.avg)} ${p.avg.toFixed(1)} (${p.n_rev} valoraciones)` : 'Nuevo en Trabajillos'}</p>
<p>${h(p.bio || '')}</p><p>${skills.map(k => `<span class="pill">${h(CATEGORIES[k].short)}</span>`).join(' ')}</p>
<p class="muted small">Comparte tu perfil: <code>${SITE}/profesional/${h(p.slug)}</code></p></article>
<section><h2>Valoraciones</h2>${revs.map(r => `<div class="card"><p>${V.stars(r.rating)} · ${h(r.name.split(' ')[0])} · ${V.ago(r.created_at)}</p><p>${h(r.text || '')}</p></div>`).join('') || '<p class="muted">Todavía sin valoraciones.</p>'}</section>
<details class="report"><summary>Denunciar este perfil</summary><form method="post" action="/denunciar" class="form">${csrf(req)}<input type="hidden" name="kind" value="user"><input type="hidden" name="target" value="${p.id}"><textarea name="reason" rows="2" maxlength="500" required></textarea><button class="btn small ghost">Enviar</button></form></details>` });
});

// ---------- cuentas ----------
function signupForm(req, v = {}, err = '') {
  const pro = (v.role || req.query.rol) === 'profesional';
  return `<section class="narrow"><h1>${pro ? 'Crea tu perfil de técnico gratis' : 'Crea tu cuenta'}</h1>
${pro ? '<p class="lead">Recibe trabajos de tu barrio en tu correo, con la respuesta ya preparada. Sin cuotas y sin pagar por contacto.</p>' : ''}
${err ? `<p class="error">${h(err)}</p>` : ''}<form method="post" action="/registro" class="form">${csrf(req)}
<input type="hidden" name="next" value="${h(v.next || req.query.next || '')}">
<label>Soy<select name="role"><option value="cliente">Necesito ayuda (cliente)</option><option value="profesional"${pro ? ' selected' : ''}>Técnico / empresa de informática</option></select></label>
<label>Nombre o nombre comercial<input name="name" required maxlength="60" value="${h(v.name || '')}"></label>
<label>Correo<input name="email" type="email" required maxlength="120" value="${h(v.email || '')}"></label>
<label>Contraseña (mín. 8)<input name="pass" type="password" required minlength="8"></label>
<label>Barrio<select name="barrio">${V.barrioOptions(v.barrio)}</select></label>
<label>Teléfono (opcional, solo lo verá quien elijas)<input name="phone" maxlength="20" value="${h(v.phone || '')}"></label>
<fieldset class="skills"><legend>Si eres técnico: ¿qué haces?</legend>${Object.entries(CATEGORIES).map(([k, c]) => `<label class="check"><input type="checkbox" name="skills" value="${k}"> ${h(c.short)}</label>`).join('')}</fieldset>
<label class="check"><input type="checkbox" name="legal" value="1" required> Acepto las <a href="/condiciones" target="_blank">condiciones</a> y la <a href="/privacidad" target="_blank">privacidad</a>.</label>
<button class="btn">Crear cuenta</button></form><p>¿Ya tienes cuenta? <a href="/entrar">Entra</a></p></section>`;
}
const safeNext = n => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//')) ? n : '/panel';
app.get('/registro', (req, res) => res.page({ title: 'Crear cuenta · Trabajillos', body: signupForm(req) }));
app.post('/registro', limiter, async (req, res) => {
  const b = req.body, s = validSignup(b);
  const role = b.role === 'profesional' ? 'profesional' : 'cliente';
  if (s.err) return res.page({ title: 'Crear cuenta', body: signupForm(req, b, s.err) }, 400);
  const skills = [].concat(b.skills || []).filter(k => CATEGORIES[k]).join(',');
  req.session.uid = await createUser({ ...s, role, barrio: BARRIOS.includes(b.barrio) ? b.barrio : null, phone: clean(b.phone, 20), skills });
  if (role === 'profesional') send(ADMIN_EMAIL, `Nuevo técnico: ${s.name}`, `${s.name} (${s.email}) · ${b.barrio} · ${skills}`);
  res.redirect(safeNext(b.next));
});
const loginForm = (req, err = '') => `<section class="narrow"><h1>Entrar</h1>${err ? `<p class="error">${h(err)}</p>` : ''}
<form method="post" action="/entrar" class="form">${csrf(req)}<input type="hidden" name="next" value="${h(req.query.next || req.body?.next || '')}">
<label>Correo<input name="email" type="email" required></label><label>Contraseña<input name="pass" type="password" required></label><button class="btn">Entrar</button></form>
<p><a href="/olvide">He olvidado la contraseña</a> · <a href="/registro">Crear cuenta</a></p></section>`;
app.get('/entrar', (req, res) => res.page({ title: 'Entrar · Trabajillos', body: loginForm(req) }));
app.post('/entrar', limiter, async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email=? AND hidden=0').get(clean(req.body.email, 120).toLowerCase());
  if (!u || !(await bcrypt.compare(String(req.body.pass || ''), u.pass))) return res.page({ title: 'Entrar', body: loginForm(req, 'Correo o contraseña incorrectos.') }, 401);
  req.session.uid = u.id; res.redirect(safeNext(req.body.next));
});
app.post('/salir', (req, res) => { req.session = null; res.redirect('/'); });
app.get('/olvide', (req, res) => res.page({ title: 'Recuperar contraseña', body: `<section class="narrow"><h1>Recuperar contraseña</h1><form method="post" class="form">${csrf(req)}<label>Correo<input name="email" type="email" required></label><button class="btn">Enviarme un enlace</button></form></section>` }));
app.post('/olvide', limiter, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(clean(req.body.email, 120).toLowerCase());
  if (u) {
    const t = crypto.randomBytes(24).toString('hex');
    db.prepare('UPDATE users SET reset_token=?, reset_exp=? WHERE id=?').run(t, Date.now() + 3600e3, u.id);
    send(u.email, 'Cambia tu contraseña de Trabajillos', `Entra aquí en la próxima hora para poner una nueva:\n${SITE}/nueva-clave/${t}`);
  }
  res.page({ title: 'Revisa tu correo', body: '<section class="narrow"><p class="ok">Si el correo existe, te hemos enviado un enlace.</p></section>' });
});
app.get('/nueva-clave/:t', (req, res) => res.page({ title: 'Nueva contraseña', body: `<section class="narrow"><h1>Nueva contraseña</h1><form method="post" class="form">${csrf(req)}<label>Contraseña (mín. 8)<input name="pass" type="password" minlength="8" required></label><button class="btn">Guardar</button></form></section>` }));
app.post('/nueva-clave/:t', limiter, async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE reset_token=? AND reset_exp>?').get(String(req.params.t), Date.now());
  if (!u || String(req.body.pass || '').length < 8) return res.page({ title: 'Enlace caducado', body: '<p class="error">El enlace ha caducado o la contraseña es muy corta.</p>' }, 400);
  db.prepare('UPDATE users SET pass=?, reset_token=NULL WHERE id=?').run(await bcrypt.hash(req.body.pass, 10), u.id);
  req.session.uid = u.id; res.redirect('/panel');
});

// ---------- panel ----------
app.get('/panel', needUser, (req, res) => {
  const me = req.user; let body = `<h1>Hola, ${h(me.name.split(' ')[0])}</h1>`;
  if (me.role === 'profesional') {
    const skills = (me.skills || '').split(',').filter(Boolean);
    const responded = new Set(db.prepare('SELECT job_id FROM responses WHERE pro_id=?').all(me.id).map(r => r.job_id));
    const open = jobsQ("AND j.status='abierto'", [], 100).filter(j => !responded.has(j.id) && j.client_id !== me.id)
      .sort((a, b) => (skills.includes(b.category) - skills.includes(a.category)) || ((b.barrio === me.barrio) - (a.barrio === me.barrio)));
    const mine = jobsQ('AND j.assigned_to=?', [me.id], 50);
    body += `<section class="box"><h2>Tu asistente</h2><p>Tienes <b>${open.length}</b> trabajos abiertos para responder${skills.length ? ', ordenados por lo que tú haces y tu barrio' : ''}. Cada uno trae la respuesta preparada.</p>
<div class="grid">${open.slice(0, 12).map(V.jobCard).join('') || '<p class="muted">Ahora mismo no hay trabajos nuevos. Te avisaremos por correo.</p>'}</div></section>
<section><h2>Tus trabajos</h2><div class="grid">${mine.map(V.jobCard).join('') || '<p class="muted">Cuando un cliente te elija, aparecerá aquí.</p>'}</div></section>`;
  } else {
    const mine = jobsQ('AND j.client_id=?', [me.id], 50);
    body += `<p><a class="btn" href="/publicar">Publicar otro trabajo</a></p><section><h2>Tus trabajos</h2><div class="grid">${mine.map(V.jobCard).join('') || '<p class="muted">Aún no has publicado nada.</p>'}</div></section>`;
  }
  const sk = new Set((me.skills || '').split(','));
  body += `<section class="narrow"><h2>Tu perfil</h2><form method="post" action="/perfil" class="form">${csrf(req)}
<label>Nombre<input name="name" maxlength="60" value="${h(me.name)}"></label><label>Barrio<select name="barrio">${V.barrioOptions(me.barrio)}</select></label>
<label>Teléfono<input name="phone" maxlength="20" value="${h(me.phone || '')}"></label>
${me.role === 'profesional' ? `<label>Sobre ti (lo verán los clientes)<textarea name="bio" rows="3" maxlength="600">${h(me.bio || '')}</textarea></label>
<fieldset class="skills"><legend>Qué haces</legend>${Object.entries(CATEGORIES).map(([k, c]) => `<label class="check"><input type="checkbox" name="skills" value="${k}"${sk.has(k) ? ' checked' : ''}> ${h(c.short)}</label>`).join('')}</fieldset>
<label class="check"><input type="checkbox" name="remote" value="1"${me.remote ? ' checked' : ''}> También trabajo en remoto</label>
<p class="muted small">Tu perfil público: <a href="/profesional/${h(me.slug)}">${SITE}/profesional/${h(me.slug)}</a></p>` : ''}
<button class="btn">Guardar</button></form></section>${me.is_admin ? '<p><a href="/admin">Administración</a></p>' : ''}`;
  res.page({ title: 'Mi panel · Trabajillos', body });
});
app.post('/perfil', needUser, (req, res) => {
  const b = req.body, skills = [].concat(b.skills || []).filter(k => CATEGORIES[k]).join(',');
  db.prepare('UPDATE users SET name=?, barrio=?, phone=?, bio=?, skills=?, remote=? WHERE id=?')
    .run(clean(b.name, 60) || req.user.name, BARRIOS.includes(b.barrio) ? b.barrio : req.user.barrio, clean(b.phone, 20), clean(b.bio, 600), skills, b.remote ? 1 : 0, req.user.id);
  res.redirect('/panel');
});

// ---------- denuncias y administración ----------
app.post('/denunciar', limiter, (req, res) => {
  const kind = ['job', 'user', 'review'].includes(req.body.kind) ? req.body.kind : null, target = int(req.body.target), reason = clean(req.body.reason, 500);
  if (kind && target && reason) {
    db.prepare('INSERT INTO reports (kind,target_id,reason,reporter) VALUES (?,?,?,?)').run(kind, target, reason, req.user?.email || 'anónimo');
    send(ADMIN_EMAIL, `Denuncia (${kind} ${target})`, `${reason}\n\n${SITE}/admin`);
  }
  res.page({ title: 'Gracias', body: '<section class="narrow"><p class="ok">Gracias. Lo revisaremos en menos de 48 horas.</p></section>' });
});
const needAdmin = (req, res, next) => req.user?.is_admin ? next() : res.status(404).send('No encontrado');
app.get('/admin', needAdmin, (req, res) => {
  const reps = db.prepare('SELECT * FROM reports WHERE resolved=0 ORDER BY created_at DESC').all();
  const users = db.prepare('SELECT id,name,email,role,barrio,created_at,hidden FROM users ORDER BY id DESC LIMIT 50').all();
  const btn = (kind, id, label) => `<form method="post" action="/admin/ocultar" class="inline">${csrf(req)}<input type="hidden" name="kind" value="${kind}"><input type="hidden" name="id" value="${id}"><button class="link">${label}</button></form>`;
  res.page({ title: 'Administración', body: `<h1>Administración</h1><h2>Denuncias pendientes (${reps.length})</h2>
${reps.map(r => `<div class="card"><b>${h(r.kind)} #${r.target_id}</b> · ${h(r.reporter)} · ${V.ago(r.created_at)}<p>${h(r.reason)}</p>${btn(r.kind, r.target_id, 'Ocultar contenido')} ${btn('report', r.id, 'Marcar resuelta')}</div>`).join('') || '<p class="muted">Nada pendiente.</p>'}
<h2>Últimos usuarios</h2><table><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Barrio</th><th></th></tr>${users.map(u => `<tr><td>${h(u.name)}</td><td>${h(u.email)}</td><td>${u.role}</td><td>${h(u.barrio || '')}</td><td>${u.hidden ? 'oculto' : btn('user', u.id, 'Ocultar')}</td></tr>`).join('')}</table>` });
});
app.post('/admin/ocultar', needAdmin, (req, res) => {
  const id = int(req.body.id), t = { job: 'jobs', user: 'users', review: 'reviews' }[req.body.kind];
  if (req.body.kind === 'report') db.prepare('UPDATE reports SET resolved=1 WHERE id=?').run(id);
  else if (t) { db.prepare(`UPDATE ${t} SET hidden=1 WHERE id=?`).run(id); db.prepare('UPDATE reports SET resolved=1 WHERE kind=? AND target_id=?').run(req.body.kind, id); }
  res.redirect('/admin');
});

require('./pages')(app, { ranking, jobsQ });

app.use((req, res) => res.page({ title: 'No encontrado · Trabajillos', body: '<h1>Esta página no existe.</h1><p><a href="/">Volver al inicio</a></p>' }, 404));
app.use((err, req, res, next) => { console.error(err); res.status(500).send('Algo ha fallado. Inténtalo de nuevo.'); });

const PORT = +(process.env.PORT || 3000);
if (require.main === module) app.listen(PORT, () => console.log(`Trabajillos escuchando en :${PORT} (${SITE})`));
module.exports = app;
