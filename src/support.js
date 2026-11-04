// Soporte tipo SAT: chat dentro de cada trabajo (cliente <-> profesional), estados de la incidencia y "Mis incidencias".
const db = require('./db');
const V = require('./views');
const { send, SITE } = require('./mail');
const { h } = V;

const STATES = { pendiente: 'Pendiente', 'en curso': 'En curso', 'esperando cliente': 'Esperando al cliente', resuelto: 'Resuelto' };
const clean = (s, n) => String(s || '').trim().slice(0, n);
const nl = s => h(s).replace(/\n/g, '<br>');

// ¿Puede este usuario ver/escribir en la conversación (trabajo j, profesional proId)?
function canTalk(me, j, proId) {
  if (!me) return false;
  if (me.is_admin) return true;
  const responded = db.prepare('SELECT 1 FROM responses WHERE job_id=? AND pro_id=?').get(j.id, proId);
  if (!responded) return false;
  return me.id === j.client_id || me.id === proId;
}

// HTML del hilo + formulario. csrf = input oculto ya renderizado.
function threadHtml(me, j, proId, csrf) {
  if (!canTalk(me, j, proId)) return '';
  const msgs = db.prepare(`SELECT m.*, u.name FROM messages m JOIN users u ON u.id=m.from_id WHERE m.job_id=? AND m.pro_id=? ORDER BY m.id`).all(j.id, proId);
  const closed = j.status === 'cerrado' || (j.assigned_to && j.assigned_to !== proId);
  return `<details class="chat" open><summary>Mensajes${msgs.length ? ` (${msgs.length})` : ''}</summary>
<div class="msgs">${msgs.map(m => `<div class="msg${m.from_id === me.id ? ' me' : ''}"><b>${h(m.name.split(' ')[0])}</b> <span class="muted small">${V.ago(m.created_at)}</span><p>${nl(m.text)}</p></div>`).join('') || '<p class="muted small">Pregunta lo que necesites antes de decidir. Os avisamos por correo de cada mensaje.</p>'}</div>
${closed ? '' : `<form method="post" action="/trabajo/${j.id}/mensaje/${proId}" class="form chatform">${csrf}<textarea name="text" rows="2" maxlength="2000" required placeholder="Escribe un mensaje…"></textarea><button class="btn small">Enviar</button></form>`}</details>`;
}

// Bloque de estado tipo ticket (solo cuando hay profesional asignado)
function ticketHtml(me, j, csrf) {
  if (!j.assigned_to || !me) return '';
  const actor = me.is_admin || me.id === j.assigned_to || me.id === j.client_id;
  if (!actor) return '';
  const evs = db.prepare(`SELECT e.*, u.name FROM events e LEFT JOIN users u ON u.id=e.by_id WHERE e.job_id=? ORDER BY e.id`).all(j.id);
  const st = j.ticket || 'pendiente';
  const opts = (me.id === j.client_id && !me.is_admin) ? ['esperando cliente', 'resuelto'].includes(st) ? ['en curso'] : [] : Object.keys(STATES).filter(s => s !== st);
  return `<section class="box ticket"><div class="row"><h2>Seguimiento</h2><span class="tk tk-${st.replace(' ', '-')}">${STATES[st]}</span></div>
<ol class="timeline">${evs.map(e => `<li><b>${h(STATES[e.value] || e.value || 'Nota')}</b> <span class="muted small">${V.ago(e.created_at)}${e.name ? ' · ' + h(e.name.split(' ')[0]) : ''}</span>${e.note ? `<p>${nl(e.note)}</p>` : ''}</li>`).join('') || '<li class="muted">Trabajo asignado. Aquí verás cada avance.</li>'}</ol>
${opts.length ? `<form method="post" action="/trabajo/${j.id}/estado" class="form">${csrf}<div class="two"><label>Cambiar estado<select name="ticket">${opts.map(s => `<option value="${s}">${STATES[s]}</option>`).join('')}</select></label>
<label>Nota (opcional)<input name="note" maxlength="500" placeholder="${me.id === j.client_id ? 'Sigue sin funcionar porque…' : 'Ej.: pieza pedida, llega el jueves'}"></label></div><button class="btn small">Actualizar</button></form>` : ''}</section>`;
}

function mount(app, { needUser, limiter, notifyAdmin }) {
  const job = id => db.prepare('SELECT * FROM jobs WHERE id=? AND hidden=0').get(id);

  app.post('/trabajo/:id/mensaje/:pro', needUser, limiter, (req, res) => {
    const j = job(req.params.id), proId = parseInt(req.params.pro, 10);
    if (!j || !canTalk(req.user, j, proId)) return res.status(404).send('No encontrado');
    const text = clean(req.body.text, 2000);
    if (text.length >= 1) {
      db.prepare('INSERT INTO messages (job_id,pro_id,from_id,text) VALUES (?,?,?,?)').run(j.id, proId, req.user.id, text);
      const toId = req.user.id === j.client_id ? proId : j.client_id;
      const to = db.prepare('SELECT * FROM users WHERE id=?').get(toId);
      if (to && to.id !== req.user.id) send(to.email, `Mensaje de ${req.user.name.split(' ')[0]} sobre "${j.title}"`,
        `${req.user.name.split(' ')[0]} te ha escrito:\n\n"${text}"\n\nResponde aquí:\n${SITE}/trabajo/${j.id}#p${proId}`);
    }
    res.redirect(`/trabajo/${j.id}#p${proId}`);
  });

  app.post('/trabajo/:id/estado', needUser, (req, res) => {
    const j = job(req.params.id); const me = req.user; const st = req.body.ticket;
    if (!j || !j.assigned_to || !STATES[st]) return res.redirect(`/trabajo/${req.params.id}`);
    const isClient = me.id === j.client_id && !me.is_admin;
    const ok = me.is_admin || me.id === j.assigned_to || (isClient && st === 'en curso');
    if (!ok) return res.redirect(`/trabajo/${j.id}`);
    const note = clean(req.body.note, 500);
    db.prepare('UPDATE jobs SET ticket=? WHERE id=?').run(st, j.id);
    db.prepare("INSERT INTO events (job_id,by_id,kind,value,note) VALUES (?,?,'estado',?,?)").run(j.id, me.id, st, note);
    if (st === 'resuelto' && j.status === 'asignado') db.prepare("UPDATE jobs SET status='terminado' WHERE id=?").run(j.id);
    if (isClient && j.status === 'terminado') db.prepare("UPDATE jobs SET status='asignado' WHERE id=?").run(j.id); // el cliente lo reabre
    const other = db.prepare('SELECT * FROM users WHERE id=?').get(me.id === j.client_id ? j.assigned_to : j.client_id);
    if (other) send(other.email, `"${j.title}": ${STATES[st]}`, `El trabajo ha pasado a: ${STATES[st]}${note ? `\nNota: ${note}` : ''}\n\n${st === 'resuelto' ? '¿Todo bien? Si sigue fallando, puedes reabrirlo desde la página. Y si quedaste contento, deja tu valoración:\n' : ''}${SITE}/trabajo/${j.id}`);
    if (isClient) notifyAdmin(`🔁 Incidencia reabierta: ${j.title}\n${SITE}/trabajo/${j.id}`);
    res.redirect(`/trabajo/${j.id}`);
  });

  app.get('/incidencias', needUser, (req, res) => {
    const me = req.user;
    const rows = db.prepare(`SELECT j.*, (SELECT text FROM messages m WHERE m.job_id=j.id ORDER BY m.id DESC LIMIT 1) last,
      (SELECT created_at FROM messages m WHERE m.job_id=j.id ORDER BY m.id DESC LIMIT 1) last_at
      FROM jobs j WHERE j.hidden=0 AND (j.client_id=? OR j.assigned_to=? OR (? AND j.assigned_to IS NOT NULL))
      ORDER BY COALESCE(last_at, j.created_at) DESC LIMIT 100`).all(me.id, me.id, me.is_admin ? 1 : 0);
    const label = j => j.assigned_to ? (STATES[j.ticket] || 'Pendiente') : j.status === 'abierto' ? 'Buscando técnico' : j.status;
    res.page({ title: 'Mis incidencias · Trabajillos', body: `<h1>Mis incidencias</h1><p class="lead">Todo lo que tienes en marcha, con su estado y el último mensaje.</p>
<table class="tickets"><tr><th>#</th><th>Trabajo</th><th>Estado</th><th>Último mensaje</th></tr>${rows.map(j => `<tr><td>${j.id}</td><td><a href="/trabajo/${j.id}">${h(j.title)}</a><div class="muted small">${h(j.barrio)} · ${V.ago(j.created_at)}</div></td>
<td><span class="tk tk-${(j.assigned_to ? j.ticket || 'pendiente' : 'abierto').replace(' ', '-')}">${h(label(j))}</span></td><td class="small">${j.last ? h(j.last.slice(0, 80)) + (j.last.length > 80 ? '…' : '') : '<span class="muted">—</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No tienes nada en marcha. <a href="/publicar">Publica un trabajo</a>.</td></tr>'}</table>` });
  });
}

module.exports = { mount, threadHtml, ticketHtml, STATES };
