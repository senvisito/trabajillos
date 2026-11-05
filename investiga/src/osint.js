// Motor de Investiga: reúne información PÚBLICA de fuentes abiertas sobre empresas, webs, teléfonos, correos
// y presencia profesional de personas. Cada dato lleva su fuente, fecha y nivel de confianza.
// Límites deliberados: no busca domicilios, familiares ni datos íntimos de particulares, ni hace reconocimiento facial.
const dns = require('dns').promises;
const { get, json } = require('./net');
const X = require('./extra');

const safe = async (p, fb = null) => { try { return await p; } catch { return fb; } };
const now = () => new Date().toISOString();
const enc = encodeURIComponent;
const strip = html => String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, ' ').trim();

// ---------- identificadores españoles ----------
const CIF_TYPES = { A: 'Sociedad anónima', B: 'Sociedad limitada', C: 'Sociedad colectiva', D: 'Sociedad comanditaria', E: 'Comunidad de bienes', F: 'Cooperativa',
  G: 'Asociación o fundación', H: 'Comunidad de propietarios', J: 'Sociedad civil', N: 'Entidad extranjera', P: 'Corporación local', Q: 'Organismo público',
  R: 'Congregación religiosa', S: 'Órgano de la Administración del Estado', U: 'Unión temporal de empresas', V: 'Otro tipo de entidad', W: 'Establecimiento permanente de entidad no residente' };
const CIF_PROV = { '01': 'Álava', '02': 'Albacete', '03': 'Alicante', '53': 'Alicante', '54': 'Alicante', '04': 'Almería', '05': 'Ávila', '06': 'Badajoz', '07': 'Baleares', '57': 'Baleares',
  '08': 'Barcelona', '58': 'Barcelona', '59': 'Barcelona', '60': 'Barcelona', '61': 'Barcelona', '62': 'Barcelona', '63': 'Barcelona', '64': 'Barcelona', '65': 'Barcelona', '66': 'Barcelona', '68': 'Barcelona',
  '09': 'Burgos', '10': 'Cáceres', '11': 'Cádiz', '72': 'Cádiz', '12': 'Castellón', '13': 'Ciudad Real', '14': 'Córdoba', '56': 'Córdoba', '15': 'A Coruña', '70': 'A Coruña', '16': 'Cuenca',
  '17': 'Girona', '55': 'Girona', '67': 'Girona', '18': 'Granada', '19': 'Guadalajara', '20': 'Gipuzkoa', '71': 'Gipuzkoa', '21': 'Huelva', '22': 'Huesca', '23': 'Jaén', '24': 'León', '25': 'Lleida',
  '26': 'La Rioja', '27': 'Lugo', '28': 'Madrid', '78': 'Madrid', '79': 'Madrid', '80': 'Madrid', '81': 'Madrid', '82': 'Madrid', '83': 'Madrid', '84': 'Madrid', '85': 'Madrid', '86': 'Madrid', '87': 'Madrid', '88': 'Madrid',
  '29': 'Málaga', '92': 'Málaga', '93': 'Málaga', '30': 'Murcia', '73': 'Murcia', '31': 'Navarra', '71x': '', '32': 'Ourense', '33': 'Asturias', '74': 'Asturias', '34': 'Palencia', '35': 'Las Palmas', '76': 'Las Palmas',
  '36': 'Pontevedra', '94': 'Pontevedra', '37': 'Salamanca', '38': 'Santa Cruz de Tenerife', '75': 'Santa Cruz de Tenerife', '39': 'Cantabria', '40': 'Segovia', '41': 'Sevilla', '90': 'Sevilla', '91': 'Sevilla',
  '42': 'Soria', '43': 'Tarragona', '77': 'Tarragona', '44': 'Teruel', '45': 'Toledo', '46': 'Valencia', '96': 'Valencia', '97': 'Valencia', '98': 'Valencia', '47': 'Valladolid', '48': 'Bizkaia', '95': 'Bizkaia',
  '49': 'Zamora', '50': 'Zaragoza', '99': 'Zaragoza', '51': 'Ceuta', '52': 'Melilla' };

function checkCIF(raw) {
  const c = String(raw).toUpperCase().replace(/[\s.-]/g, '');
  const m = c.match(/^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/); if (!m) return null;
  const d = m[2].split('').map(Number);
  let s = d[1] + d[3] + d[5];
  for (const i of [0, 2, 4, 6]) { const x = d[i] * 2; s += Math.floor(x / 10) + (x % 10); }
  const ctl = (10 - (s % 10)) % 10, letter = 'JABCDEFGHI'[ctl], last = m[3];
  const valid = 'PQRSNW'.includes(m[1]) ? last === letter : 'ABEH'.includes(m[1]) ? last === String(ctl) : (last === letter || last === String(ctl));
  return { value: c, valid, type: CIF_TYPES[m[1]], province: CIF_PROV[m[2].slice(0, 2)] || null };
}
function checkNIF(raw) {
  const c = String(raw).toUpperCase().replace(/[\s.-]/g, '');
  let m = c.match(/^([XYZ]?)(\d{7,8})([A-Z])$/); if (!m) return null;
  const num = parseInt((m[1] ? { X: '0', Y: '1', Z: '2' }[m[1]] : '') + m[2], 10);
  return { value: c, valid: 'TRWAGMYFPDXBNJZSQVHLCKE'[num % 23] === m[3], kind: m[1] ? 'NIE' : 'DNI' };
}

// ---------- teléfonos españoles ----------
const PREFIX = { 91: 'Madrid', 93: 'Barcelona', 94: 'País Vasco', 95: 'Andalucía', 96: 'Comunidad Valenciana / Murcia', 98: 'Asturias, Galicia, Cantabria o Castilla y León', 97: 'Aragón, Baleares, Cataluña o Valencia', 92: 'Canarias, Castilla, Extremadura o Andalucía',
  961: 'Valencia', 962: 'Valencia', 963: 'Valencia (ciudad)', 960: 'Valencia', 964: 'Castellón', 965: 'Alicante', 966: 'Alicante', 968: 'Murcia', 967: 'Albacete', 971: 'Baleares', 976: 'Zaragoza', 954: 'Sevilla', 952: 'Málaga', 958: 'Granada', 957: 'Córdoba', 985: 'Asturias', 981: 'A Coruña', 986: 'Pontevedra', 983: 'Valladolid', 948: 'Navarra', 942: 'Cantabria', 928: 'Las Palmas', 922: 'Santa Cruz de Tenerife' };
function phoneInfo(raw) {
  let d = String(raw).replace(/[^\d+]/g, ''); if (d.startsWith('+34')) d = d.slice(3); else if (d.startsWith('0034')) d = d.slice(4);
  if (!/^\d{9}$/.test(d)) return null;
  const f = d[0], p3 = d.slice(0, 3), p2 = d.slice(0, 2);
  let type, alert = null;
  if (f === '6' || f === '7') type = 'Móvil';
  else if (['800', '900'].includes(p3)) type = 'Gratuito para quien llama';
  else if (['901', '902'].includes(p3)) { type = 'Coste compartido (902/901)'; alert = 'Las llamadas a 902 suelen costar más que una llamada normal.'; }
  else if (['803', '806', '807', '905'].includes(p3)) { type = 'Tarificación adicional'; alert = 'Es un número de tarificación especial: llamar puede costar mucho dinero. Muy usado en estafas.'; }
  else if (f === '9' || f === '8') type = 'Fijo · ' + (PREFIX[p3] || PREFIX[p2] || 'España');
  else type = 'Desconocido';
  return { number: d, pretty: d.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3'), type, alert };
}

const FREE_MAIL = new Set(['gmail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'yahoo.com', 'yahoo.es', 'live.com', 'icloud.com', 'protonmail.com', 'proton.me', 'gmx.com', 'gmx.es', 'aol.com', 'msn.com', 'telefonica.net', 'ono.com']);
const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'yopmail.com', 'trashmail.com', 'getnada.com', 'sharklasers.com', 'dispostable.com', 'maildrop.cc', 'fakeinbox.com', 'mohmal.com', 'emailondeck.com', 'tempr.email']);

// ---------- detección del tipo de consulta ----------
function detect(q, hint) {
  const s = String(q || '').trim();
  if (hint && hint !== 'auto') return hint;
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s)) return 'correo';
  if (checkCIF(s)) return 'cif';
  if (checkNIF(s)) return 'nif';
  if (phoneInfo(s)) return 'telefono';
  if (/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i.test(s) && !/\s/.test(s)) return 'web';
  if (/\b(s\.?l\.?u?|s\.?a\.?u?|sociedad|grupo|asociaci[oó]n|fundaci[oó]n|cooperativa|ltd|inc|gmbh|corp)\b\.?$/i.test(s)) return 'empresa';
  return 'empresa';
}
const toDomain = s => String(s).trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/^www\./, '');

// ---------- fuentes ----------
async function wikidata(name, wantHuman) {
  const s = await safe(json(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${enc(name)}&language=es&uselang=es&format=json&limit=6&origin=*`), null);
  if (!s || !s.search || !s.search.length) return null;
  const ids = s.search.map(x => x.id).join('|');
  const e = await safe(json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=claims|labels|descriptions|sitelinks&languages=es|en&format=json&origin=*`), null);
  if (!e) return null;
  const ent = s.search.map(x => e.entities[x.id]).find(x => {
    const p31 = (x.claims.P31 || []).map(c => c.mainsnak.datavalue && c.mainsnak.datavalue.value.id);
    return wantHuman ? p31.includes('Q5') : !p31.includes('Q5');
  });
  if (!ent) return null;
  const val = p => { const c = (ent.claims[p] || [])[0]; return c && c.mainsnak.datavalue ? c.mainsnak.datavalue.value : null; };
  const ref = ['P17', 'P159', 'P452', 'P106', 'P39', 'P108', 'P27', 'P31'].flatMap(p => (ent.claims[p] || []).slice(0, 3).map(c => c.mainsnak.datavalue && c.mainsnak.datavalue.value.id)).filter(Boolean);
  const labs = ref.length ? await safe(json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${[...new Set(ref)].join('|')}&props=labels&languages=es|en&format=json&origin=*`), null) : null;
  const L = id => labs && labs.entities[id] ? (labs.entities[id].labels.es || labs.entities[id].labels.en || {}).value : null;
  const many = p => (ent.claims[p] || []).slice(0, 3).map(c => L(c.mainsnak.datavalue && c.mainsnak.datavalue.value.id)).filter(Boolean).join(', ') || null;
  const time = p => { const v = val(p); return v && v.time ? v.time.slice(1, 5) : null; };
  const wiki = ent.sitelinks.eswiki ? ent.sitelinks.eswiki.title : ent.sitelinks.enwiki ? ent.sitelinks.enwiki.title : null;
  const lang = ent.sitelinks.eswiki ? 'es' : 'en';
  const sum = wiki ? await safe(json(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${enc(wiki)}`), null) : null;
  return { id: ent.id, label: (ent.labels.es || ent.labels.en || {}).value, description: (ent.descriptions.es || ent.descriptions.en || {}).value,
    website: val('P856'), inception: time('P571'), country: many('P17'), hq: many('P159'), industry: many('P452'), occupation: many('P106'),
    position: many('P39'), employer: many('P108'), kind: many('P31'), wikiUrl: sum && sum.content_urls ? sum.content_urls.desktop.page : null, extract: sum ? sum.extract : null };
}
async function gleif(name) {
  const r = await safe(json(`https://api.gleif.org/api/v1/lei-records?filter[fulltext]=${enc(name)}&page[size]=3`), null);
  return ((r && r.data) || []).map(d => ({ lei: d.id, name: d.attributes.entity.legalName.name, status: d.attributes.entity.status, form: d.attributes.entity.legalForm && d.attributes.entity.legalForm.other,
    country: d.attributes.entity.legalAddress.country, city: d.attributes.entity.legalAddress.city, regId: d.attributes.entity.registeredAs }));
}
async function news(term) {
  const r = await safe(json(`https://api.gdeltproject.org/api/v2/doc/doc?query=${enc(`"${term}"`)}&mode=artlist&maxrecords=12&sort=datedesc&format=json`, { timeout: 12000 }), null);
  return ((r && r.articles) || []).map(a => ({ title: a.title, url: a.url, source: a.domain, date: a.seendate ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}` : null, lang: a.language }));
}
async function rdap(domain) {
  const r = await safe(json(`https://rdap.org/domain/${enc(domain)}`, { timeout: 8000 }), null);
  if (!r) return null;
  const ev = a => ((r.events || []).find(e => e.eventAction === a) || {}).eventDate || null;
  const reg = (r.entities || []).find(e => (e.roles || []).includes('registrar'));
  const regName = reg && reg.vcardArray ? ((reg.vcardArray[1] || []).find(v => v[0] === 'fn') || [])[3] : null;
  return { created: ev('registration'), updated: ev('last changed'), expires: ev('expiration'), registrar: regName, status: r.status };
}
async function wayback(domain) {
  const r = await safe(json(`https://archive.org/wayback/available?url=${enc(domain)}&timestamp=19960101`, { timeout: 8000 }), null);
  const s = r && r.archived_snapshots && r.archived_snapshots.closest;
  return s ? { first: `${s.timestamp.slice(0, 4)}-${s.timestamp.slice(4, 6)}-${s.timestamp.slice(6, 8)}`, url: s.url } : null;
}
async function certs(domain) {
  const r = await safe(json(`https://crt.sh/?q=${enc(domain)}&output=json&exclude=expired`, { timeout: 15000 }), null);
  const all = await safe(json(`https://crt.sh/?q=%25.${enc(domain)}&output=json`, { timeout: 15000 }), null) || r || [];
  if (!all.length) return null;
  const first = all.map(c => c.not_before).sort()[0];
  const subs = new Set(all.flatMap(c => String(c.name_value).split('\n')).map(s => s.toLowerCase().replace(/^\*\./, '')).filter(s => s.endsWith(domain)));
  return { firstCert: first ? first.slice(0, 10) : null, subdomains: subs.size, names: [...subs].filter(x => x !== domain).sort().slice(0, 25) };
}

// Web de la empresa: página principal + aviso legal/contacto. Extrae lo que la propia empresa publica.
async function website(domain) {
  const home = await safe(get(`https://${domain}/`), null) || await safe(get(`http://${domain}/`), null);
  if (!home || home.status >= 400) return { reachable: false };
  const html = home.body;
  const title = (html.match(/<title[^>]*>([^<]{1,200})/i) || [])[1];
  const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})/i) || [])[1];
  const links = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)].map(m => ({ href: m[1], text: strip(m[2]).toLowerCase() }));
  const legalLinks = [...new Set(links.filter(l => /aviso[\s-]?legal|legal|privacidad|privacy|contact|quienes|qui[eé]nes|sobre[\s-]nosotros|about|empresa|equipo|nosotros|servicios/i.test(l.href + ' ' + l.text))
    .map(l => { try { return new URL(l.href, home.url).toString(); } catch { return null; } }).filter(u => u && new URL(u).hostname.replace(/^www\./, '') === domain))].slice(0, 7);
  const pages = [{ url: home.url, html }];
  for (const u of legalLinks) { const p = await safe(get(u, { maxBytes: 8e5, timeout: 7000 }), null); if (p && p.status < 400) pages.push({ url: p.url, html: p.body }); }
  const found = { cif: [], razon: [], registro: [], emails: new Set(), phones: new Set(), social: new Set(), address: new Set(), legalPage: null };
  const generator = (html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']{1,80})/i) || [])[1];
  const keywords = (html.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']{1,300})/i) || [])[1];
  for (const p of pages) {
    const t = strip(p.html);
    if (/aviso legal|informaci[oó]n legal|datos identificativos|LSSI/i.test(t) && !found.legalPage && p.url !== home.url) found.legalPage = p.url;
    for (const m of t.matchAll(/\b(?:C\.?I\.?F\.?|N\.?I\.?F\.?)?\s*:?\s*([ABCDEFGHJNPQRSUVW][-\s]?\d{7}[-\s]?[0-9A-J])\b/g)) { const c = checkCIF(m[1]); if (c && !found.cif.some(x => x.value === c.value)) found.cif.push({ ...c, page: p.url }); }
    for (const m of t.matchAll(/(?:raz[oó]n social|denominaci[oó]n social|titular(?: del sitio| de la web)?)\s*:?\s*([A-ZÁÉÍÓÚÑ0-9][^:;|]{2,70}?(?:S\.?\s?L\.?\s?U?\.?|S\.?\s?A\.?\s?U?\.?|S\.?\s?L\.?\s?L\.?|S\.?\s?COOP\.?|Ltd\.?|SLP)?)(?=[,.;]|\s+(?:con|CIF|NIF|domicilio|inscrita|y\s)|$)/gi))
      if (found.razon.length < 3 && !found.razon.includes(m[1].trim())) found.razon.push(m[1].trim());
    for (const m of t.matchAll(/((?:C\/|Calle|C\.|Avda\.?|Avenida|Av\.|Plaza|Pza\.?|Camino|Carrer|Paseo|Passeig|Pol\.?\s?Ind\.?|Pol[ií]gono|Ronda|Gran V[ií]a)\s[^|]{3,90}?\b\d{5}\b(?:\s[A-ZÁÉÍÓÚ][\wáéíóúñ'-]+){0,3})/g)) if (found.address.size < 3) found.address.add(m[1].replace(/\s+/g, ' ').trim());
    for (const m of t.matchAll(/(Registro Mercantil de [A-ZÁÉÍÓÚ][\wáéíóúñ ]{2,30}[^.]{0,120})/g)) if (found.registro.length < 2) found.registro.push(m[1].trim());
    for (const m of p.html.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(m[0]) && found.emails.size < 6) found.emails.add(m[0].toLowerCase());
    for (const m of t.matchAll(/(?:\+34\s?)?\b([6789]\d{2})[\s.]?(\d{2,3})[\s.]?(\d{2,3})[\s.]?(\d{0,3})\b/g)) { const n = (m[1] + m[2] + m[3] + m[4]); if (n.length === 9 && found.phones.size < 4) found.phones.add(n.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')); }
    for (const m of p.html.matchAll(/https?:\/\/(?:www\.)?(facebook\.com|instagram\.com|linkedin\.com\/(?:company|in)|twitter\.com|x\.com|tiktok\.com\/@|youtube\.com\/(?:@|c\/|channel\/))[^"'\s<>)]*/gi))
      if (found.social.size < 8 && !/sharer|share\?|intent\/|plugins|dialog/.test(m[0])) found.social.add(m[0].replace(/\/$/, ''));
  }
  return { reachable: true, url: home.url, title: title && title.trim(), description: desc, https: home.url.startsWith('https'), ...found,
    generator, keywords, emails: [...found.emails], phones: [...found.phones], social: [...found.social], address: [...found.address], pagesRead: pages.map(p => p.url) };
}

// ---------- informes por tipo ----------
function newReport(query, type, notes) {
  const R = { query, type, notes, createdAt: now(), facts: [], signals: [], news: [], links: [], sections: [], limits: [] };
  R.fact = (label, value, source, url, confidence = 'alta') => { if (value) R.facts.push({ label, value: String(value), source, url, confidence, date: now().slice(0, 10) }); };
  R.signal = (level, text, source) => R.signals.push({ level, text, source });
  R.link = (label, url) => R.links.push({ label, url });
  return R;
}

async function domainSection(R, domain, depth = 'full') {
  const [W, D, A, C, mx, DI, WB, SG] = await Promise.all([website(domain), rdap(domain), wayback(domain), certs(domain), safe(dns.resolveMx(domain), []),
    X.dnsIntel(domain), X.waybackStats(domain), depth === 'full' || depth === 'light' ? X.securityGrade(domain) : null]);
  const IPO = DI && DI.ips[0] ? await X.ipOwner(DI.ips[0]) : null;
  const src = W.url || `https://${domain}`;
  if (!W.reachable) R.signal('atencion', `La web ${domain} no responde.`, 'Conexión directa');
  else {
    R.fact('Web', W.url, 'La propia web', W.url); R.fact('Título de la web', W.title, 'La propia web', W.url); R.fact('Descripción', W.description, 'La propia web', W.url, 'media');
    W.razon.forEach(r => R.fact('Razón social publicada', r, 'Aviso legal de la web', W.legalPage || src, 'media'));
    W.cif.forEach(c => { R.fact('CIF publicado', `${c.value} · ${c.valid ? 'formato válido' : 'NO válido'}${c.type ? ' · ' + c.type : ''}${c.province ? ' · ' + c.province : ''}`, 'Aviso legal de la web', c.page);
      R.signal(c.valid ? 'bien' : 'alerta', c.valid ? `Publica un CIF con formato válido (${c.value}).` : `El CIF que publica (${c.value}) no supera la comprobación de dígito de control.`, 'Validación de CIF'); });
    W.registro.forEach(r => R.fact('Registro Mercantil', r, 'Aviso legal de la web', W.legalPage || src, 'media'));
    W.emails.forEach(e => R.fact('Correo publicado', e, 'La propia web', src)); W.phones.forEach(p => R.fact('Teléfono publicado', p, 'La propia web', src));
    W.social.forEach(s => R.fact('Perfil enlazado desde la web', s, 'La propia web', src));
    W.address.forEach(a => R.fact('Dirección publicada', a, 'La propia web', W.legalPage || src, 'media'));
    R.fact('Hecha con', W.generator, 'La propia web', src, 'media'); R.fact('Palabras clave que usa', W.keywords, 'La propia web', src, 'media');
    R.fact('Páginas leídas', W.pagesRead.length, 'La propia web', null);
    if (W.legalPage) R.signal('bien', 'Tiene página de aviso legal.', W.legalPage); else if (depth === 'full') R.signal('atencion', 'No hemos encontrado un aviso legal enlazado. En España, las webs con actividad económica deben identificar a su titular (LSSI).', 'Lectura de la web');
    if (!W.cif.length && depth === 'full') R.signal('atencion', 'La web no muestra un CIF/NIF visible.', 'Lectura de la web');
    if (!W.https) R.signal('atencion', 'La web no usa HTTPS.', 'Conexión directa');
    if (W.emails.length && W.emails.every(e => FREE_MAIL.has(e.split('@')[1]))) R.signal('atencion', 'Solo publica correos de servicios gratuitos (Gmail, Hotmail…), no de su propio dominio.', 'La propia web');
  }
  if (D) { R.fact('Dominio registrado el', D.created && D.created.slice(0, 10), 'RDAP (registro de dominios)', `https://rdap.org/domain/${domain}`); R.fact('Registrador', D.registrar, 'RDAP', `https://rdap.org/domain/${domain}`); R.fact('Caduca el', D.expires && D.expires.slice(0, 10), 'RDAP', `https://rdap.org/domain/${domain}`); }
  else if (/\.es$/.test(domain)) R.limits.push('El registro de dominios .es no publica la fecha de alta; la estimamos con el archivo de Internet y los certificados.');
  if (A) R.fact('Primera copia en el archivo de Internet', A.first, 'Wayback Machine (archive.org)', A.url);
  if (C) { R.fact('Primer certificado HTTPS', C.firstCert, 'Certificate Transparency (crt.sh)', `https://crt.sh/?q=${domain}`); R.fact('Subdominios con certificado', C.subdomains, 'crt.sh', `https://crt.sh/?q=%25.${domain}`); }
  const since = [D && D.created, A && A.first, C && C.firstCert].filter(Boolean).map(d => new Date(d)).sort((a, b) => a - b)[0];
  if (since) { const months = (Date.now() - since) / (30.4 * 864e5);
    if (months < 6) R.signal('alerta', `El dominio es muy reciente (desde ${since.toISOString().slice(0, 10)}). Muchas webs fraudulentas tienen semanas o pocos meses.`, 'Fecha de alta / archivo');
    else R.signal('bien', `El dominio existe al menos desde ${since.getFullYear()} (${Math.floor(months / 12)} años).`, 'Fecha de alta / archivo'); }
  if (C && C.names.length) R.fact('Subdominios', C.names.join(' · '), 'Certificate Transparency (crt.sh)', `https://crt.sh/?q=%25.${domain}`);
  if (WB) R.fact('Historial en el archivo de Internet', `${WB.months} meses con copias (de ${WB.first} a ${WB.last})`, 'Wayback Machine (archive.org)', `https://web.archive.org/web/*/${domain}`);
  if (DI) { R.fact('Servicios que usa', DI.services.join(' · '), 'Registros DNS (TXT, SPF y MX)', null, 'media'); R.fact('DNS gestionado por', DI.nsProvider, 'Registros NS', null); R.fact('IP del servidor', DI.ips.join(', '), 'DNS', null); }
  if (IPO) R.fact('Alojada en', [IPO.org, IPO.name].filter(Boolean).join(' · ') + (IPO.country ? ` (${IPO.country})` : ''), 'RDAP de la IP', `https://rdap.org/ip/${DI.ips[0]}`);
  if (SG) { R.fact('Nota de seguridad de la web', `${SG.grade} · ${SG.score}/100 · ${SG.counts.critica + SG.counts.alta} fallos graves, ${SG.counts.media} medios`, 'Radiografía Web', SG.url);
    if ('AB'.includes(SG.grade)) R.signal('bien', `Su web saca una ${SG.grade} en seguridad.`, 'Radiografía Web'); else if ('EF'.includes(SG.grade)) R.signal('atencion', `Su web saca una ${SG.grade} en seguridad: tiene fallos que deberían corregir.`, 'Radiografía Web'); }
  if (mx.length) { const prov = mx.map(m => m.exchange).join(' '); R.fact('Correo gestionado por', /google/i.test(prov) ? 'Google Workspace' : /outlook|microsoft/i.test(prov) ? 'Microsoft 365' : mx[0].exchange, 'DNS (registros MX)', null); }
  R.link('Radiografía de seguridad de la web', `https://escaner.civicloud.es/?d=${enc(domain)}`);
  R.link('Opiniones en Trustpilot', `https://es.trustpilot.com/search?query=${enc(domain)}`);
  R.link('Comprobar en ScamAdviser', `https://www.scamadviser.com/es/comprobar-sitio-web/${enc(domain)}`);
  R.link('Historial en el archivo de Internet', `https://web.archive.org/web/*/${enc(domain)}`);
  return W;
}

function companyLinks(R, name) {
  R.link('Anuncios en el BORME (BOE)', `https://www.boe.es/buscar/anborme.php?campo%5B0%5D=TITULO&dato%5B0%5D=${enc(name)}&operador%5B0%5D=and&page_hits=50&sort_field%5B0%5D=FPU&sort_order%5B0%5D=desc&accion=Buscar`);
  R.link('Actos del Registro Mercantil (LibreBORME)', `https://www.google.com/search?q=${enc('site:librebor.me "' + name + '"')}`);
  R.link('Ficha en Empresite', `https://www.google.com/search?q=${enc('site:empresite.eleconomista.es "' + name + '"')}`);
  R.link('Ficha en einforma', `https://www.einforma.com/servlet/app/prod/BUSQUEDA_EMPRESAS/?ts_query=${enc(name)}`);
  R.link('Ficha en infoempresa', `https://www.infoempresa.com/es-es/es/buscar?q=${enc(name)}`);
  R.link('Google Maps', `https://www.google.com/maps/search/${enc(name)}`);
  R.link('LinkedIn', `https://www.linkedin.com/search/results/companies/?keywords=${enc(name)}`);
  R.link('Opiniones en Trustpilot', `https://es.trustpilot.com/search?query=${enc(name)}`);
  R.link('Noticias en Google', `https://news.google.com/search?q=${enc('"' + name + '"')}&hl=es`);
}

function mergeNews(...lists) { const seen = new Set(); return lists.flat().filter(n => { const k = (n.title || '').toLowerCase().slice(0, 60); if (!k || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 20); }
async function extrasFor(R, name) {
  const [gn, gd, wm, geo] = await Promise.all([X.googleNews(name), news(name), X.wikiMentions(name), X.osm(name)]);
  R.news = mergeNews(R.news, gn, gd);
  if (R.news.length) R.signal('bien', `Aparece en ${R.news.length} noticias o publicaciones.`, 'Google News / GDELT');
  wm.forEach(m => R.fact('Mención en Wikipedia', `${m.title}: …${m.snippet}…`, 'Wikipedia', m.url, 'media'));
  geo.forEach(g => { R.fact('Ubicación en el mapa', `${g.name} · ${g.address}`, 'OpenStreetMap', g.url, 'media'); R.fact('Teléfono en el mapa', g.phone, 'OpenStreetMap', g.url, 'media'); R.fact('Horario', g.hours, 'OpenStreetMap', g.url, 'media'); R.fact('Web en el mapa', g.website, 'OpenStreetMap', g.url, 'media'); });
}

async function investigate({ query, type: hint, notes = '' }, onProgress = () => {}) {
  const q = String(query || '').trim().slice(0, 200);
  if (q.length < 2) throw new Error('Escribe qué quieres investigar.');
  const type = detect(q, hint);
  const R = newReport(q, type, String(notes).slice(0, 1500));
  // dominio que el usuario nos pasa en las notas (si lo hay)
  const noteDomain = (String(notes).match(/\b((?:[a-z0-9-]+\.)+(?:es|com|net|org|eu|io|cat|info|biz|shop|store|online|tech))\b/i) || [])[1];

  if (type === 'web') {
    const d = toDomain(q); onProgress('Leyendo la web y su aviso legal');
    const W = await domainSection(R, d);
    const name = (W.razon && W.razon[0]) || (W.title || '').split(/[|\-–·:]/)[0].trim();
    if (name && name.length > 2) { onProgress('Buscando noticias y ubicación'); await extrasFor(R, name.length > 3 ? name : d); companyLinks(R, name); }
  }
  else if (type === 'empresa' || type === 'cif') {
    let name = q;
    if (type === 'cif') {
      const c = checkCIF(q); R.fact('CIF', `${c.value} · ${c.valid ? 'formato válido' : 'NO válido'}`, 'Validación del dígito de control', null);
      R.fact('Tipo de entidad', c.type, 'Letra del CIF', null); R.fact('Provincia de inscripción original', c.province, 'Dígitos del CIF', null, 'media');
      R.signal(c.valid ? 'bien' : 'alerta', c.valid ? 'El CIF tiene un formato válido.' : 'El CIF no es válido: el dígito de control no cuadra. Puede ser inventado o estar mal escrito.', 'Validación de CIF');
      R.limits.push('Hacienda no ofrece una consulta pública gratuita de CIF a nombre. Usa los enlaces del BORME y de directorios de empresas.');
    } else {
      onProgress('Consultando Wikidata y el registro mundial de entidades (LEI)');
      const [wd, lei] = await Promise.all([wikidata(q, false), gleif(q)]);
      if (wd) { R.fact('Identificada como', `${wd.label}${wd.description ? ' — ' + wd.description : ''}`, 'Wikidata', `https://www.wikidata.org/wiki/${wd.id}`, 'media');
        R.fact('Fundada', wd.inception, 'Wikidata', `https://www.wikidata.org/wiki/${wd.id}`); R.fact('Sede', wd.hq, 'Wikidata', `https://www.wikidata.org/wiki/${wd.id}`);
        R.fact('Sector', wd.industry, 'Wikidata', `https://www.wikidata.org/wiki/${wd.id}`); R.fact('País', wd.country, 'Wikidata', `https://www.wikidata.org/wiki/${wd.id}`);
        R.fact('Web oficial', wd.website, 'Wikidata', `https://www.wikidata.org/wiki/${wd.id}`); if (wd.extract) R.sections.push({ title: 'Resumen de Wikipedia', text: wd.extract, source: wd.wikiUrl }); }
      lei.forEach(l => R.fact('Entidad con LEI', `${l.name} · ${l.city || ''} (${l.country}) · ${l.status === 'ACTIVE' ? 'activa' : l.status}${l.regId ? ' · registro ' + l.regId : ''}`, 'GLEIF (identificador LEI)', `https://search.gleif.org/#/record/${l.lei}`, 'media'));
      if (!wd && !lei.length) R.limits.push('No aparece en Wikidata ni en el registro LEI (normal en pymes). Revisa los enlaces al BORME y directorios.');
      let site = noteDomain || (wd && wd.website && toDomain(wd.website));
      if (!site) {
        onProgress('Buscando su web');
        const disc = await X.discoverDomains(q);
        const best = disc.find(d => d.live && !d.parked && d.score >= 4);
        if (best) { site = (best.finalHost || best.domain); R.fact('Web encontrada', `${site}${best.title ? ' — ' + best.title : ''}`, 'Búsqueda de dominios con su nombre', `https://${site}`, 'media'); }
        disc.filter(d => d !== best).slice(0, 6).forEach(d => R.fact('Otro dominio con ese nombre', `${d.domain} · ${!d.live ? 'registrado, sin web' : d.parked ? 'aparcado o sin contenido' : (d.title || 'con web')}`, 'DNS y conexión directa', d.live ? `https://${d.domain}` : null, 'media'));
      }
      if (site) { onProgress('Leyendo su web, su aviso legal y su seguridad'); await domainSection(R, toDomain(site), 'full'); }
      else R.limits.push('No hemos encontrado una web con ese nombre. Si la conoces, escríbela en «Lo que ya sabes» y la analizaremos.');
      onProgress('Buscando noticias, menciones y ubicación'); await extrasFor(R, q);
    }
    companyLinks(R, name);
  }
  else if (type === 'persona') {
    R.limits.push('Para personas solo mostramos presencia pública y profesional (cargos, noticias, perfiles profesionales). No buscamos domicilios, familiares, teléfonos personales ni identificamos a nadie por su cara.');
    onProgress('Buscando presencia pública');
    const [wd, nw, gn, wm] = await Promise.all([wikidata(q, true), news(q), X.googleNews(q), X.wikiMentions(q)]);
    wm.forEach(m => R.fact('Mención en Wikipedia', `${m.title}: …${m.snippet}…`, 'Wikipedia', m.url, 'media'));
    if (wd) { R.fact('Persona con perfil público', `${wd.label}${wd.description ? ' — ' + wd.description : ''}`, 'Wikidata', `https://www.wikidata.org/wiki/${wd.id}`, 'media');
      R.fact('Ocupación', wd.occupation, 'Wikidata', `https://www.wikidata.org/wiki/${wd.id}`); R.fact('Cargos', wd.position, 'Wikidata', `https://www.wikidata.org/wiki/${wd.id}`);
      R.fact('Trabaja o ha trabajado en', wd.employer, 'Wikidata', `https://www.wikidata.org/wiki/${wd.id}`);
      if (wd.extract) R.sections.push({ title: 'Resumen de Wikipedia', text: wd.extract, source: wd.wikiUrl });
      R.signal('atencion', 'Puede haber otras personas con el mismo nombre: comprueba que el perfil corresponde a quien buscas.', 'Homónimos'); }
    R.news = mergeNews(gn, nw);
    if (!wd && !R.news.length) R.limits.push('No hay información pública relevante sobre este nombre en las fuentes consultadas. Es lo normal en personas que no tienen actividad pública.');
    R.link('Cargos en sociedades (LibreBORME)', `https://www.google.com/search?q=${enc('site:librebor.me "' + q + '"')}`);
    R.link('Perfil profesional en LinkedIn', `https://www.linkedin.com/search/results/people/?keywords=${enc(q)}`);
    R.link('Noticias en Google', `https://news.google.com/search?q=${enc('"' + q + '"')}&hl=es`);
  }
  else if (type === 'telefono') {
    const p = phoneInfo(q); R.fact('Número', p.pretty, 'Plan de numeración', null); R.fact('Tipo', p.type, 'Plan de numeración español', 'https://avancedigital.mineco.gob.es/es-es/Servicios/Numeracion/', 'alta');
    if (p.alert) R.signal('alerta', p.alert, 'Plan de numeración');
    R.signal('atencion', 'El prefijo no confirma quién llama: los estafadores pueden falsificar el número que aparece en pantalla.', 'Spoofing');
    R.link('Opiniones en ListaSpam', `https://www.listaspam.com/busca.php?Telefono=${p.number}`); R.link('Opiniones en Tellows', `https://www.tellows.es/num/${p.number}`);
    R.link('Buscar en Google', `https://www.google.com/search?q=${enc('"' + p.pretty + '" OR "' + p.number + '"')}`);
    R.limits.push('No consultamos a qué persona pertenece un número particular. Para empresas, el número suele aparecer en su web o en los enlaces de búsqueda.');
  }
  else if (type === 'correo') {
    const [user, dom] = q.toLowerCase().split('@'); const mx = await safe(dns.resolveMx(dom), []);
    R.fact('Dominio del correo', dom, 'Dirección', null); R.fact('Acepta correo', mx.length ? 'Sí (tiene servidores MX)' : 'No', 'DNS', null);
    if (!mx.length) R.signal('alerta', 'Ese dominio no puede recibir correo: la dirección no funciona o es falsa.', 'DNS');
    if (DISPOSABLE.has(dom)) R.signal('alerta', 'Es un correo temporal o desechable.', 'Lista de dominios desechables');
    if (FREE_MAIL.has(dom)) R.signal('atencion', 'Es un correo gratuito (Gmail, Hotmail…). Si dice ser de una empresa o un banco, desconfía.', 'Proveedor');
    else if (!DISPOSABLE.has(dom) && mx.length) { onProgress('Leyendo la web del dominio'); await domainSection(R, dom, 'light'); }
    R.link('Buscar el correo en Google', `https://www.google.com/search?q=${enc('"' + q + '"')}`);
    R.limits.push('No buscamos filtraciones ni cuentas asociadas a correos de particulares.');
  }
  else if (type === 'nif') {
    const n = checkNIF(q); R.fact(n.kind, `${n.valid ? 'Formato válido' : 'Formato NO válido'}`, 'Validación de la letra', null);
    R.signal(n.valid ? 'bien' : 'alerta', n.valid ? 'La letra corresponde al número.' : 'La letra no corresponde al número: puede ser inventado o estar mal escrito.', 'Validación');
    R.limits.push('Un DNI o NIE identifica a una persona física: solo comprobamos si el formato es correcto, no buscamos a quién pertenece.');
  }
  const order = { alerta: 0, atencion: 1, bien: 2 };
  R.signals.sort((a, b) => order[a.level] - order[b.level]);
  const seen = new Set(); R.links = R.links.filter(l => !seen.has(l.label) && seen.add(l.label));
  R.summary = summarize(R);
  delete R.fact; delete R.signal; delete R.link;
  return R;
}

function summarize(R) {
  const a = R.signals.filter(s => s.level === 'alerta').length, w = R.signals.filter(s => s.level === 'atencion').length, b = R.signals.filter(s => s.level === 'bien').length;
  const what = { web: 'la web', empresa: 'la empresa', cif: 'el CIF', persona: 'la persona', telefono: 'el teléfono', correo: 'el correo', nif: 'el documento' }[R.type];
  let s = `Hemos reunido ${R.facts.length} datos públicos sobre ${what} "${R.query}" con su fuente.`;
  if (a) s += ` Hay ${a} señal${a > 1 ? 'es' : ''} de alerta que conviene revisar antes de confiar.`;
  else if (w) s += ` No hay alertas graves, pero sí ${w} punto${w > 1 ? 's' : ''} a tener en cuenta.`;
  else if (b) s += ' No hemos encontrado señales de alerta.';
  return s;
}

// Resumen redactado con IA (opcional, solo si hay clave configurada). Solo usa los datos ya reunidos.
async function aiSummary(R) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  const facts = R.facts.map(f => `- ${f.label}: ${f.value} (fuente: ${f.source})`).join('\n');
  const sig = R.signals.map(s => `- [${s.level}] ${s.text}`).join('\n');
  const prompt = `Eres analista de fuentes abiertas. Con SOLO estos datos sobre "${R.query}" (${R.type}), escribe en español sencillo un resumen de 4-6 frases para alguien que quiere saber si puede fiarse. No inventes nada que no esté en los datos; si falta información, dilo.\n\nDatos:\n${facts}\n\nSeñales:\n${sig}\n\nNotas del usuario: ${R.notes || '—'}`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-haiku-5-5', max_tokens: 400, messages: [{ role: 'user', content: prompt }] }), signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null; const j = await r.json(); return j.content && j.content[0] && j.content[0].text;
  } catch { return null; }
}

module.exports = { investigate, aiSummary, detect, checkCIF, checkNIF, phoneInfo };
