// Plantillas HTML renderizadas en el servidor (buenas para Google). Todo texto de usuario pasa por h().
const { CATEGORIES, BARRIOS } = require('./data');
const { SITE } = require('./mail');

const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stars = r => r ? '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r)) : '';
const ago = d => {
  const s = (Date.now() - new Date(d.replace(' ', 'T') + 'Z')) / 1000;
  if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} días`;
};
const money = j => j.budget_max ? `${j.budget_min ? j.budget_min + '–' : 'hasta '}${j.budget_max} €` : 'A consultar';

function layout({ title, desc, body, user, csrf, canonical, jsonld }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)}</title><meta name="description" content="${h(desc || 'Publica gratis lo que necesitas y te contactan técnicos de informática de València. Sin pagar por contacto.')}">
${canonical ? `<link rel="canonical" href="${SITE}${h(canonical)}">` : ''}
<meta property="og:title" content="${h(title)}"><meta property="og:description" content="${h(desc || '')}"><meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Figtree:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="/style.css">${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head><body>
<header class="top"><div class="wrap nav">
  <a class="logo" href="/">trabajillos<span>.</span></a>
  <nav><a href="/trabajos">Trabajos</a><a href="/ranking">Ranking</a>${user
    ? `<a href="/panel">Mi panel</a><form method="post" action="/salir" class="inline"><input type="hidden" name="_csrf" value="${h(csrf)}"><button class="link">Salir</button></form>`
    : `<a href="/entrar">Entrar</a>`}<a class="btn small" href="/publicar">Publicar gratis</a></nav>
</div></header>
<main class="wrap">${body}</main>
<footer class="foot"><div class="wrap">
  <p><b>trabajillos.</b> La forma gratis de encontrar a alguien de informática en València. Nadie paga por contactar.</p>
  <p class="links"><a href="/servicios">Servicios por barrio</a><a href="/como-funciona">Cómo funciona</a><a href="/aviso-legal">Aviso legal</a><a href="/privacidad">Privacidad</a><a href="/condiciones">Condiciones</a><a href="/cookies">Cookies</a></p>
</div></footer></body></html>`;
}

const catOptions = sel => Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${h(c.name)}</option>`).join('');
const barrioOptions = sel => BARRIOS.map(b => `<option${b === sel ? ' selected' : ''}>${h(b)}</option>`).join('');

function jobCard(j) {
  return `<a class="card job" href="/trabajo/${j.id}">
  <div class="meta"><span class="pill">${h(CATEGORIES[j.category]?.short || j.category)}</span>${j.urgency === 'urgente' ? '<span class="pill hot">Urgente</span>' : ''}<span class="muted">${h(j.barrio)} · ${ago(j.created_at)}</span></div>
  <h3>${h(j.title)}</h3><p>${h(j.description.slice(0, 140))}${j.description.length > 140 ? '…' : ''}</p>
  <div class="meta"><b>${money(j)}</b><span class="muted">${j.n_resp || 0} respuesta${j.n_resp == 1 ? '' : 's'}</span><span class="status s-${j.status}">${j.status}</span></div></a>`;
}

function proCard(p, i) {
  return `<a class="card pro" href="/profesional/${h(p.slug)}">
  ${i != null ? `<span class="rank">${i + 1}</span>` : ''}<div><h3>${h(p.name)}</h3>
  <div class="muted">${h(p.barrio || 'València')}${p.remote ? ' · también en remoto' : ''}</div>
  <div class="stars">${p.n_rev ? `${stars(p.avg)} <b>${p.avg.toFixed(1)}</b> <span class="muted">(${p.n_rev})</span>` : '<span class="muted">Nuevo en Trabajillos</span>'}</div>
  <div class="muted small">${p.done || 0} trabajo${p.done == 1 ? '' : 's'} hecho${p.done == 1 ? '' : 's'}</div></div></a>`;
}

module.exports = { h, layout, jobCard, proCard, catOptions, barrioOptions, stars, ago, money, CATEGORIES, BARRIOS };
