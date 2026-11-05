// Motor de análisis. Solo hace lo que haría un navegador o una consulta DNS normal (análisis pasivo),
// salvo las comprobaciones "ampliadas", que solo se ejecutan si el dueño ha verificado el dominio.
const dns = require('dns').promises;
const { get, tlsInfo, json } = require('./net');
const { detect, OSV_NPM } = require('./tech');

const SEV_W = { critica: 25, alta: 15, media: 7, baja: 3, info: 0, ok: 0 };

function normalizeDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s)) return null;
  if (/(^|\.)(local|localhost|internal|lan|home|corp|test|invalid|example)$/.test(s)) return null;
  return s;
}
const apex = d => d.replace(/^www\./, '');
const safe = async (p, fb = null) => { try { return await p; } catch { return fb; } };
const daysLeft = d => Math.round((new Date(d) - Date.now()) / 864e5);
const cmpVer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };

async function scan(domainInput, { extended = false, onProgress = () => {} } = {}) {
  const domain = normalizeDomain(domainInput);
  if (!domain) throw new Error('Escribe un dominio válido, por ejemplo: miempresa.es');
  const F = []; // hallazgos
  const add = (sev, cat, title, detail, fix = '', evidence = '', confidence = 'confirmado') => F.push({ sev, cat, title, detail, fix, evidence, confidence });
  const R = { domain, startedAt: new Date().toISOString(), tech: [], dns: {}, tls: null, http: null, subdomains: [], extended };
  const base = apex(domain);

  // ---------- DNS ----------
  onProgress('Consultando DNS y correo');
  const [A, AAAA, MX, NS, TXT, CAA, DMARC] = await Promise.all([
    safe(dns.resolve4(domain), []), safe(dns.resolve6(domain), []), safe(dns.resolveMx(base), []), safe(dns.resolveNs(base), []),
    safe(dns.resolveTxt(base), []), safe(dns.resolveCaa(base), []), safe(dns.resolveTxt('_dmarc.' + base), [])]);
  R.dns = { A, AAAA, MX: MX.sort((a, b) => a.priority - b.priority), NS, CAA, TXT: TXT.map(t => t.join('')) };
  if (!A.length && !AAAA.length) { add('alta', 'Dominio y DNS', 'El dominio no apunta a ningún servidor', 'No hemos encontrado direcciones IP para este dominio, así que la web no carga.', 'Revisa los registros A/AAAA en tu proveedor de dominio.'); }
  R.dns.ptr = await safe(A[0] ? dns.reverse(A[0]) : Promise.resolve([]), []);

  // Correo: SPF, DMARC, DKIM
  const spf = R.dns.TXT.find(t => /^v=spf1/i.test(t));
  const dmarc = DMARC.map(t => t.join('')).find(t => /^v=DMARC1/i.test(t));
  R.dns.SPF = spf || null; R.dns.DMARC = dmarc || null;
  if (MX.length || spf) {
    if (!spf) add('media', 'Correo', 'No tiene registro SPF', 'Cualquiera puede enviar correos haciéndose pasar por tu dominio y es más fácil que tus correos acaben en spam.', 'Añade un registro TXT "v=spf1 include:<tu proveedor> -all" con los servidores que envían tu correo.');
    else if (/\+all/i.test(spf)) add('alta', 'Correo', 'El SPF permite enviar a cualquiera (+all)', 'Tu SPF autoriza a todos los servidores del mundo a enviar en nombre de tu dominio. Es como no tenerlo.', 'Cambia "+all" por "-all" o "~all".', spf);
    else if (/\?all/i.test(spf)) add('media', 'Correo', 'El SPF es neutral (?all)', 'No dice qué hacer con correos falsos, así que casi no protege.', 'Cambia "?all" por "~all" o "-all".', spf);
    else if (/~all/i.test(spf)) add('baja', 'Correo', 'SPF en modo suave (~all)', 'Los correos falsos se marcan como sospechosos, pero no se rechazan.', 'Cuando tengas todo bien configurado, pasa a "-all".', spf);
    else add('ok', 'Correo', 'SPF configurado', 'Tu dominio dice qué servidores pueden enviar su correo.', '', spf);
    if (spf && (spf.match(/include:|a[:\s]|mx[:\s]|ptr|exists:|redirect=/gi) || []).length > 10) add('media', 'Correo', 'El SPF tiene demasiadas consultas', 'SPF admite como máximo 10 consultas DNS; si se pasa, los servidores lo ignoran.', 'Reduce los "include".', spf);
    if (!dmarc) add('media', 'Correo', 'No tiene DMARC', 'Sin DMARC no hay una política para rechazar correos que suplantan tu dominio (phishing con tu nombre).', 'Empieza con un TXT en _dmarc: "v=DMARC1; p=none; rua=mailto:tu@correo" y sube a p=quarantine o p=reject.');
    else if (/p=none/i.test(dmarc)) add('baja', 'Correo', 'DMARC en modo observación (p=none)', 'Recibes informes, pero los correos falsos siguen entregándose.', 'Cuando revises los informes, pasa a p=quarantine y luego a p=reject.', dmarc);
    else add('ok', 'Correo', 'DMARC activo', 'Los correos que suplantan tu dominio se ponen en cuarentena o se rechazan.', '', dmarc);
    const sels = ['google', 'default', 'selector1', 'selector2', 'k1', 'mail', 'dkim', 's1', 's2', 'smtp', 'mx', 'zoho', 'protonmail', 'mailjet', 'sendgrid'];
    const found = (await Promise.all(sels.map(s => safe(dns.resolveTxt(`${s}._domainkey.${base}`), []).then(r => r.length ? s : null)))).filter(Boolean);
    R.dns.DKIM = found;
    if (found.length) add('ok', 'Correo', 'Firma DKIM encontrada', `Hemos encontrado claves DKIM (selector: ${found.join(', ')}).`);
    else add('info', 'Correo', 'No hemos encontrado DKIM en los selectores habituales', 'Puede que uses un selector con otro nombre. Si no tienes DKIM, tus correos son menos fiables.', 'Activa DKIM en tu proveedor de correo.', '', 'indicio');
  } else add('info', 'Correo', 'El dominio no recibe correo', 'No tiene servidores de correo (MX). Si no envías correo con él, publica "v=spf1 -all" para que nadie lo suplante.');
  if (!CAA.length) add('info', 'Dominio y DNS', 'Sin registro CAA', 'El registro CAA indica qué entidades pueden emitir certificados para tu dominio. Es una protección extra opcional.', 'Añade, por ejemplo: 0 issue "letsencrypt.org".');
  const ds = await safe(json(`https://dns.google/resolve?name=${base}&type=DS`, { timeout: 5000 }), null);
  R.dns.DNSSEC = !!(ds && Array.isArray(ds.Answer) && ds.Answer.length);

  // ---------- HTTPS / TLS ----------
  onProgress('Comprobando HTTPS y certificado');
  const T = await tlsInfo(domain); R.tls = T;
  if (T.error) add('alta', 'Seguridad web', 'La web no funciona con HTTPS', 'No hemos podido conectar de forma cifrada. Los navegadores la marcarán como "No segura".', 'Instala un certificado gratuito (Let\'s Encrypt) y activa HTTPS.', T.error);
  else {
    const dl = daysLeft(T.valid_to);
    if (!T.authorized) add(dl < 0 ? 'critica' : 'alta', 'Seguridad web', dl < 0 ? 'El certificado ha caducado' : 'Certificado no válido', dl < 0 ? `Caducó hace ${-dl} días. Los visitantes ven un aviso de peligro.` : `Los navegadores no confían en él (${T.authError}).`, 'Renueva o reinstala el certificado.', `${T.issuer?.O || ''} · caduca ${T.valid_to}`);
    else if (dl < 14) add('media', 'Seguridad web', `El certificado caduca en ${dl} días`, 'Si no se renueva a tiempo, la web mostrará un aviso de seguridad.', 'Comprueba que la renovación automática funciona.', T.valid_to);
    else add('ok', 'Seguridad web', 'Certificado válido', `Emitido por ${T.issuer?.O || T.issuer?.CN || '—'}, caduca en ${dl} días.`, '', T.valid_to);
    if (T.protocol && /TLSv1(\.1)?$/.test(T.protocol)) add('alta', 'Seguridad web', 'Usa un protocolo de cifrado obsoleto', `La conexión usa ${T.protocol}.`, 'Activa TLS 1.2 y 1.3 y desactiva los anteriores.');
    const old = await Promise.all([['TLSv1', 'TLSv1'], ['TLSv1.1', 'TLSv1.1']].map(([a, b]) => tlsInfo(domain, { minVersion: a, maxVersion: b, timeout: 5000 })));
    const acc = old.filter(o => !o.error).map(o => o.protocol);
    R.tls.legacy = acc;
    if (acc.length) add('media', 'Seguridad web', 'Acepta protocolos antiguos (' + acc.join(', ') + ')', 'TLS 1.0 y 1.1 tienen fallos conocidos y están retirados desde 2020.', 'Desactívalos en la configuración del servidor o del hosting.');
  }

  // ---------- HTTP ----------
  onProgress('Analizando la página y sus cabeceras');
  let H = await safe(get(`https://${domain}/`), null);
  const plain = await safe(get(`http://${domain}/`, { follow: 0, maxBytes: 2e4 }), null);
  if (!H) H = await safe(get(`http://${domain}/`), null);
  if (!H) { add('alta', 'Seguridad web', 'La web no responde', 'No hemos podido cargar la página principal.', 'Comprueba que el servidor está encendido.'); return finish(R, F); }
  const h = H.headers, html = H.body || '';
  R.http = { status: H.status, finalUrl: H.url, ms: H.ms, redirects: H.redirects, server: h.server || null, headers: pick(h) };
  if (plain && plain.status >= 200 && plain.status < 300) add('media', 'Seguridad web', 'La versión sin HTTPS no redirige', 'Quien escriba la dirección sin "https" navega sin cifrar.', 'Redirige todo el tráfico http:// a https:// (redirección 301).');
  const isHttps = H.url.startsWith('https');

  // Cabeceras de seguridad
  const hs = h['strict-transport-security'];
  if (isHttps && !hs) add('baja', 'Seguridad web', 'Falta HSTS', 'HSTS obliga al navegador a usar siempre HTTPS y evita ataques en wifis públicas.', 'Añade la cabecera Strict-Transport-Security: max-age=31536000; includeSubDomains');
  else if (hs) add('ok', 'Seguridad web', 'HSTS activo', 'El navegador usará siempre HTTPS.', '', hs);
  const csp = h['content-security-policy'];
  if (!csp) add('baja', 'Seguridad web', 'Sin política de seguridad de contenido (CSP)', 'La CSP limita qué scripts pueden ejecutarse y frena muchos ataques XSS.', 'Añade una cabecera Content-Security-Policy adaptada a tu web.');
  else add('ok', 'Seguridad web', 'Tiene CSP', 'Limita qué contenido puede cargar la página.', '', csp.slice(0, 160));
  if (!h['x-frame-options'] && !(csp && /frame-ancestors/i.test(csp))) add('baja', 'Seguridad web', 'Se puede incrustar en otras webs', 'Otra web podría mostrar la tuya dentro de un marco para engañar a los usuarios (clickjacking).', 'Añade X-Frame-Options: SAMEORIGIN o frame-ancestors en la CSP.');
  if (!/nosniff/i.test(h['x-content-type-options'] || '')) add('baja', 'Seguridad web', 'Falta X-Content-Type-Options', 'Evita que el navegador interprete archivos como un tipo distinto.', 'Añade X-Content-Type-Options: nosniff');
  if (!h['referrer-policy']) add('info', 'Seguridad web', 'Sin Referrer-Policy', 'Controla qué información de tus URLs se envía a otras webs.', 'Añade Referrer-Policy: strict-origin-when-cross-origin');
  // Cookies
  const badCk = H.rawCookies.filter(c => (isHttps && !/;\s*secure/i.test(c)) || !/;\s*httponly/i.test(c) || !/;\s*samesite/i.test(c));
  if (badCk.length) add('baja', 'Seguridad web', `${badCk.length} cookie(s) sin protecciones`, 'Algunas cookies no tienen Secure, HttpOnly o SameSite, lo que facilita robar sesiones.', 'Añade esas opciones al crear las cookies.', badCk.map(c => c.split('=')[0]).join(', '));
  // Contenido mixto
  if (isHttps) {
    const mixed = [...html.matchAll(/<(?:script|img|iframe|link)[^>]+(?:src|href)=["'](http:\/\/[^"']+)/gi)].map(m => m[1]).slice(0, 5);
    if (mixed.length) add('baja', 'Seguridad web', 'Carga recursos sin cifrar', 'La página segura carga archivos por http://; el navegador puede bloquearlos o mostrar avisos.', 'Cambia esas URLs a https://.', mixed.join('\n'));
  }
  // Divulgación de versiones
  const disclose = [h.server, h['x-powered-by'], h['x-aspnet-version']].filter(v => v && /\d/.test(v));
  if (disclose.length) add('baja', 'Software y versiones', 'El servidor muestra versiones de software', 'Mostrar versiones exactas ayuda a un atacante a buscar fallos conocidos.', 'Oculta las versiones (ServerTokens Prod en Apache, server_tokens off en nginx, expose_php = Off).', disclose.join(' · '));

  // ---------- Tecnologías y versiones ----------
  onProgress('Detectando tecnologías y versiones');
  R.tech = detect(h, html);
  await checkVersions(R.tech, add);

  // robots y security.txt
  const [robots, sectxt] = await Promise.all([safe(get(`${origin(H.url)}/robots.txt`, { maxBytes: 5e4 }), null), safe(get(`${origin(H.url)}/.well-known/security.txt`, { maxBytes: 2e4 }), null)]);
  R.robots = robots && robots.status === 200 && /user-agent/i.test(robots.body);
  R.securityTxt = sectxt && sectxt.status === 200 && /contact:/i.test(sectxt.body);
  if (!R.securityTxt) add('info', 'Dominio y DNS', 'Sin security.txt', 'Este archivo dice a investigadores cómo avisarte si encuentran un fallo.', 'Publica /.well-known/security.txt con una línea "Contact: mailto:...".');
  if (H.ms > 3000) add('baja', 'Rendimiento', `La página tarda ${(H.ms / 1000).toFixed(1)} s en responder`, 'Más de 3 segundos hace que mucha gente se vaya y penaliza en Google.', 'Revisa el hosting, la caché y el tamaño de las imágenes.');
  else add('ok', 'Rendimiento', `Responde en ${(H.ms / 1000).toFixed(1)} s`, 'Tiempo de respuesta del servidor razonable.');

  // ---------- Subdominios (certificados públicos) ----------
  onProgress('Buscando subdominios en certificados públicos');
  const ct = await safe(json(`https://crt.sh/?q=%25.${encodeURIComponent(base)}&output=json`, { timeout: 15000 }), []);
  R.subdomains = [...new Set((ct || []).flatMap(c => String(c.name_value).split('\n')).map(s => s.trim().toLowerCase().replace(/^\*\./, ''))
    .filter(s => s.endsWith(base) && s !== base))].sort().slice(0, 80);
  const risky = R.subdomains.filter(s => /^(dev|test|staging|stage|pre|beta|old|backup|admin|panel|cpanel|phpmyadmin|vpn|git|jenkins|intranet)[.-]/.test(s));
  if (risky.length) add('info', 'Dominio y DNS', 'Subdominios que conviene revisar', 'Hay subdominios con nombres de entornos de pruebas o administración. Si no se usan, mejor retirarlos; si se usan, que no sean públicos.', 'Revisa que estén protegidos o elimínalos.', risky.slice(0, 10).join('\n'), 'indicio');

  // ---------- Análisis ampliado (solo con dominio verificado) ----------
  if (extended) { onProgress('Análisis ampliado'); await extendedChecks(origin(H.url), R, add); }
  return finish(R, F);
}

async function checkVersions(tech, add) {
  for (const t of tech) {
    if (!t.version) continue;
    if (OSV_NPM[t.name]) {
      const r = await safe(json('https://api.osv.dev/v1/query', { body: { version: t.version, package: { name: OSV_NPM[t.name], ecosystem: 'npm' } } }), null);
      const v = (r && r.vulns) || [];
      t.vulns = v.map(x => ({ id: (x.aliases || []).find(a => a.startsWith('CVE')) || x.id, summary: x.summary || '' }));
      if (v.length) add(v.length > 2 ? 'media' : 'baja', 'Software y versiones', `${t.name} ${t.version} tiene ${v.length} vulnerabilidad(es) conocidas`, 'Es una versión antigua de una librería que se carga en el navegador de tus visitantes.', `Actualiza ${t.name} a la última versión.`, t.vulns.slice(0, 6).map(x => `${x.id} ${x.summary}`).join('\n'), 'indicio');
    }
    if (t.name === 'WordPress') {
      const r = await safe(json('https://api.wordpress.org/core/version-check/1.7/'), null);
      const latest = r && r.offers && r.offers[0] && r.offers[0].current;
      t.latest = latest;
      if (latest && cmpVer(t.version, latest) < 0) {
        const major = t.version.split('.').slice(0, 2).join('.') !== latest.split('.').slice(0, 2).join('.');
        add(major ? 'alta' : 'media', 'Software y versiones', `WordPress desactualizado (${t.version}, la última es ${latest})`, 'Las versiones antiguas de WordPress son la puerta de entrada más común en webs pequeñas.', 'Actualiza WordPress, los plugins y el tema desde el panel.', 'Versión anunciada en la propia web', 'indicio');
      } else if (latest) add('ok', 'Software y versiones', `WordPress al día (${t.version})`, 'La versión que anuncia la web es la más reciente.');
      add('baja', 'Software y versiones', 'WordPress anuncia su versión', 'La etiqueta "generator" dice qué versión usas, lo que facilita buscar fallos.', 'Ocúltala con un plugin de seguridad o desde el tema.');
    }
    if (t.name === 'PHP') {
      const r = await safe(json('https://endoflife.date/api/php.json'), null);
      const cyc = r && r.find(c => t.version.startsWith(c.cycle + '.') || t.version === c.cycle);
      if (cyc && cyc.eol && cyc.eol !== false && new Date(cyc.eol) < new Date()) add('alta', 'Software y versiones', `PHP ${t.version} ya no recibe parches de seguridad`, `La rama ${cyc.cycle} dejó de tener soporte el ${cyc.eol}. Los fallos nuevos ya no se corrigen.`, 'Pide a tu hosting que pase a una versión de PHP con soporte.', 'Versión anunciada en la cabecera X-Powered-By', 'indicio');
    }
  }
}

async function extendedChecks(base, R, add) {
  const probes = [
    ['/.git/HEAD', b => /^ref: refs\//.test(b), 'critica', 'Repositorio .git expuesto', 'Cualquiera puede descargar el código fuente de la web, a veces con contraseñas dentro.', 'Bloquea el acceso a /.git en el servidor o bórralo del directorio público.'],
    ['/.env', b => /^[A-Z_]+=.+/m.test(b) && !/<html/i.test(b), 'critica', 'Archivo .env expuesto', 'Suele contener contraseñas de la base de datos y claves de servicios.', 'Mueve el .env fuera del directorio público y cambia todas las claves que contenga.'],
    ['/wp-config.php.bak', b => /DB_PASSWORD/.test(b), 'critica', 'Copia de wp-config expuesta', 'Contiene la contraseña de la base de datos de WordPress.', 'Bórrala y cambia la contraseña de la base de datos.'],
    ['/phpinfo.php', b => /<title>phpinfo\(\)/i.test(b), 'media', 'phpinfo() público', 'Muestra la configuración completa del servidor.', 'Borra ese archivo.'],
    ['/server-status', b => /Apache Server Status/i.test(b), 'media', 'Estado de Apache público', 'Muestra las peticiones que recibe el servidor en tiempo real.', 'Restringe /server-status a tu IP.'],
    ['/wp-json/wp/v2/users', b => { try { const j = JSON.parse(b); return Array.isArray(j) && j.length && j[0].slug; } catch { return false; } }, 'baja', 'Se pueden listar los usuarios de WordPress', 'Facilita ataques de fuerza bruta contra el login.', 'Desactiva el endpoint de usuarios con un plugin de seguridad.'],
    ['/wp-content/uploads/', b => /<title>Index of/i.test(b), 'media', 'Listado de archivos visible', 'Se puede navegar por todos los archivos subidos.', 'Desactiva el listado de directorios (Options -Indexes).'],
    ['/xmlrpc.php', b => /XML-RPC server accepts POST requests only/i.test(b), 'baja', 'XML-RPC de WordPress activo', 'Se usa en ataques de fuerza bruta y amplificación.', 'Desactívalo si no usas la app móvil ni Jetpack.'],
  ];
  R.probes = [];
  for (const [p, test, sev, title, detail, fix] of probes) {
    const r = await safe(get(base + p, { follow: 0, maxBytes: 3e4, timeout: 6000 }), null);
    const hit = r && r.status === 200 && test(r.body || '');
    R.probes.push({ path: p, status: r ? r.status : null, hit: !!hit });
    if (hit) add(sev, 'Exposición', title, detail, fix, base + p);
  }
  if (!R.probes.some(p => p.hit)) add('ok', 'Exposición', 'No hemos encontrado archivos sensibles expuestos', `Hemos comprobado ${probes.length} rutas habituales.`);
}

function finish(R, F) {
  const penalty = F.reduce((n, f) => n + SEV_W[f.sev], 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : score >= 35 ? 'E' : 'F';
  const order = { critica: 0, alta: 1, media: 2, baja: 3, info: 4, ok: 5 };
  F.sort((a, b) => order[a.sev] - order[b.sev]);
  return { ...R, findings: F, score, grade, finishedAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.keys(order).map(k => [k, F.filter(f => f.sev === k).length])) };
}
const origin = u => { const x = new URL(u); return `${x.protocol}//${x.host}`; };
function pick(h) { const keep = ['server', 'x-powered-by', 'content-type', 'strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'cache-control', 'cf-ray', 'via'];
  return Object.fromEntries(keep.filter(k => h[k]).map(k => [k, String(h[k]).slice(0, 300)])); }

module.exports = { scan, normalizeDomain };
