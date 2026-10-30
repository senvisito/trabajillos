// Páginas SEO (servicio × barrio), páginas informativas, legales, sitemap y robots.
const { CATEGORIES, BARRIOS, slugify } = require('./data');
const V = require('./views');
const { SITE } = require('./mail');
const { h } = V;

const L = {
  name: process.env.LEGAL_NAME || '[TITULAR]', nif: process.env.LEGAL_NIF || '[NIF]',
  addr: process.env.LEGAL_ADDRESS || '[DIRECCIÓN]', email: process.env.LEGAL_EMAIL || process.env.ADMIN_EMAIL || '[CORREO]',
};
const barrioBySlug = Object.fromEntries(BARRIOS.map(b => [slugify(b), b]));

module.exports = (app, { ranking, jobsQ }) => {
  app.get('/servicios', (req, res) => res.page({ title: 'Servicios de informática en València por barrio · Trabajillos', canonical: '/servicios',
    body: `<h1>Servicios de informática en València</h1>${Object.entries(CATEGORIES).map(([k, c]) => `<section><h2><a href="/servicios/${k}">${h(c.name)}</a></h2>
<p class="links">${BARRIOS.filter(b => !b.includes('remoto')).map(b => `<a href="/servicios/${k}/${slugify(b)}">${h(b)}</a>`).join(' ')}</p></section>`).join('')}` }));

  const servicePage = (req, res, k, barrio) => {
    const c = CATEGORIES[k]; const where = barrio ? ` en ${barrio}` : ' en València';
    const pros = ranking(k).slice(0, 6);
    const jobs = jobsQ('AND j.category=?' + (barrio ? ' AND j.barrio=?' : ''), barrio ? [k, barrio] : [k], 6);
    const title = `${c.name}${where} · Presupuestos gratis | Trabajillos`;
    res.page({ title, canonical: `/servicios/${k}${barrio ? '/' + slugify(barrio) : ''}`,
      desc: `¿Necesitas ${c.short.toLowerCase()}${where}? Publica gratis y recibe respuestas de técnicos cercanos. Precio orientativo: ${c.price[0]}–${c.price[1]} €.`,
      jsonld: { '@context': 'https://schema.org', '@type': 'Service', serviceType: c.name, areaServed: barrio ? `${barrio}, València` : 'València',
        offers: { '@type': 'AggregateOffer', priceCurrency: 'EUR', lowPrice: c.price[0], highPrice: c.price[1] } },
      body: `<section class="hero small"><div><p class="kicker">${h(barrio || 'València')}</p><h1>${h(c.name)}${h(where)}</h1>
<p class="lead">Cuéntalo gratis y te escriben técnicos${barrio ? ' de ' + h(barrio) + ' y alrededores' : ' de València'}. Nadie paga por contactar.</p>
<p><a class="btn" href="/publicar">Pedir presupuesto gratis</a></p></div>
<aside class="stats"><div><b>${c.price[0]}–${c.price[1]} €</b><span>precio orientativo</span></div></aside></section>
<section><h2>Técnicos mejor valorados</h2><div class="grid">${pros.map((p, i) => V.proCard(p, i)).join('') || '<p class="empty">¿Eres técnico? <a href="/registro?rol=profesional">Aparece aquí gratis</a>.</p>'}</div></section>
${jobs.length ? `<section><h2>Trabajos recientes</h2><div class="grid">${jobs.map(V.jobCard).join('')}</div></section>` : ''}
<section class="how"><h2>Preguntas frecuentes</h2>
<h3>¿Cuánto cuesta un técnico de ${h(c.short.toLowerCase())}${h(where)}?</h3><p>Normalmente entre ${c.price[0]} y ${c.price[1]} €, según el problema. Cada técnico te da su precio antes de empezar.</p>
<h3>¿Tengo que pagar por publicar?</h3><p>No. Publicar es gratis y los técnicos tampoco pagan por responderte.</p>
<h3>¿Y si nadie me contesta?</h3><p>Si en 24 horas nadie te ha respondido, te contestamos nosotros.</p></section>` });
  };
  app.get('/servicios/:cat', (req, res, next) => CATEGORIES[req.params.cat] ? servicePage(req, res, req.params.cat) : next());
  app.get('/servicios/:cat/:barrio', (req, res, next) => (CATEGORIES[req.params.cat] && barrioBySlug[req.params.barrio])
    ? servicePage(req, res, req.params.cat, barrioBySlug[req.params.barrio]) : next());

  const info = (path, title, html) => app.get(path, (req, res) => res.page({ title: `${title} · Trabajillos`, canonical: path, body: `<section class="narrow prose"><h1>${title}</h1>${html}</section>` }));
  info('/como-funciona', 'Cómo funciona', `<p><b>Para clientes:</b> describe lo que necesitas, el asistente te ayuda a completarlo y te dice cuánto suele costar. Te escriben técnicos, ves sus valoraciones y eliges. Gratis.</p>
<p><b>Para técnicos:</b> crea tu perfil gratis. Te avisamos por correo de trabajos de tu zona con la respuesta ya preparada. No pagas por contactar ni cuotas.</p>
<p><b>Ranking:</b> se ordena por valoraciones de clientes reales (solo tras un trabajo terminado) y trabajos hechos. No se puede pagar para subir.</p>
<p><b>Respuesta garantizada:</b> si un trabajo lleva 24 horas sin respuestas, lo atiende nuestro equipo.</p>`);
  info('/aviso-legal', 'Aviso legal', `<p>Titular: ${h(L.name)} · NIF ${h(L.nif)} · ${h(L.addr)} · ${h(L.email)}.</p>
<p>Trabajillos es una plataforma que pone en contacto a personas que necesitan servicios de informática con profesionales. El titular no es parte de los acuerdos entre usuarios ni presta los servicios publicados, salvo cuando su propio equipo responde a un trabajo, en cuyo caso se identifica como tal.</p>
<p>Puedes denunciar cualquier contenido con el enlace «Denunciar» de cada anuncio o perfil. Revisamos las denuncias en 48 horas.</p>`);
  info('/privacidad', 'Política de privacidad', `<p>Responsable: ${h(L.name)} (${h(L.email)}).</p>
<p><b>Qué datos tratamos:</b> nombre, correo, contraseña cifrada, barrio, teléfono (opcional) y el contenido que publiques.</p>
<p><b>Para qué:</b> prestar el servicio (publicar trabajos, poner en contacto, valoraciones) y enviarte avisos relacionados. Base legal: ejecución del contrato que aceptas al registrarte.</p>
<p><b>Quién los ve:</b> tu correo y teléfono solo los ve el profesional o cliente con el que cierras un trabajo. Las valoraciones de clientes solo las ven profesionales registrados y de forma agregada.</p>
<p><b>Cuánto tiempo:</b> mientras tengas cuenta. Puedes pedir acceso, rectificación o borrado escribiendo a ${h(L.email)}, y reclamar ante la AEPD.</p>
<p>No vendemos tus datos ni usamos publicidad de terceros.</p>`);
  info('/condiciones', 'Condiciones de uso', `<ol><li>Publicar y responder es gratis.</li><li>Publica solo trabajos reales y legales. No se permiten datos de contacto en anuncios ni contenido ofensivo.</li>
<li>Las valoraciones deben ser sinceras y solo se pueden dejar tras un trabajo terminado.</li><li>Los acuerdos de precio y servicio son entre cliente y profesional.</li>
<li>Podemos retirar contenido o cuentas que incumplan estas normas.</li></ol>`);
  info('/cookies', 'Cookies', `<p>Solo usamos una cookie técnica necesaria para mantener tu sesión iniciada. No usamos cookies de publicidad ni de analítica de terceros, por eso no te pedimos consentimiento.</p>`);

  app.get('/robots.txt', (req, res) => res.type('text').send(`User-agent: *\nAllow: /\nDisallow: /panel\nDisallow: /admin\nSitemap: ${SITE}/sitemap.xml\n`));
  app.get('/sitemap.xml', (req, res) => {
    const urls = ['/', '/trabajos', '/ranking', '/publicar', '/servicios', '/como-funciona'];
    for (const k of Object.keys(CATEGORIES)) { urls.push(`/servicios/${k}`); for (const b of BARRIOS) if (!b.includes('remoto')) urls.push(`/servicios/${k}/${slugify(b)}`); }
    for (const p of ranking()) urls.push(`/profesional/${p.slug}`);
    for (const j of jobsQ('', [], 500)) urls.push(`/trabajo/${j.id}`);
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${SITE}${u}</loc></url>`).join('')}</urlset>`);
  });
};
