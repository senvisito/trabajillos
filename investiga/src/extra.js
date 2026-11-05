// Fuentes adicionales de Investiga: descubrimiento de la web de una empresa, noticias de Google News (RSS),
// Wikipedia, OpenStreetMap, servicios que delatan los registros DNS, dueño de la IP, historial del archivo
// y la nota de seguridad del escáner. Todo son fuentes públicas.
const dns = require('dns').promises;
const { get, json, UA } = require('./net');

const safe = async (p, fb = null) => { try { return await p; } catch { return fb; } };
const enc = encodeURIComponent;
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const decode = s => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

// ---------- ¿cuál es la web de esta empresa? ----------
async function discoverDomains(name) {
  const base = norm(name).replace(/\b(s\.?\s?l\.?\s?u?|s\.?\s?a\.?\s?u?|sociedad limitada|sociedad anonima|slp|sll|coop)\.?$/i, '').replace(/[^a-z0-9 -]/g, '').trim();
  if (!base || base.length < 3) return [];
  const slugs = [...new Set([base.replace(/[\s-]+/g, ''), base.replace(/\s+/g, '-')])].filter(s => s.length >= 3 && s.length <= 40);
  const tlds = ['es', 'com', 'net', 'org', 'eu', 'cat', 'tech', 'io', 'info', 'online', 'shop'];
  const cands = slugs.flatMap(s => tlds.map(t => `${s}.${t}`)).slice(0, 18);
  const words = base.split(/\s+/).filter(w => w.length > 2);
  const res = await Promise.all(cands.map(async d => {
    const ip = await safe(dns.resolve4(d), []); if (!ip.length) return null;
    const r = await safe(get(`https://${d}/`, { maxBytes: 4e5, timeout: 6000 }), null) || await safe(get(`http://${d}/`, { maxBytes: 4e5, timeout: 6000 }), null);
    if (!r || r.status >= 400) return { domain: d, live: false, score: 1 };
    const finalHost = new URL(r.url).hostname.replace(/^www\./, '');
    const text = norm(r.body.slice(0, 2e5));
    const title = ((r.body.match(/<title[^>]*>([^<]{1,200})/i) || [])[1] || '').trim();
    const parked = /domain (is )?for sale|se vende este dominio|parked|sedo|dan\.com|this domain|hostinger|plesk default|welcome to nginx|apache2 (ubuntu|debian) default|index of \//i.test(r.body.slice(0, 3e4));
    let score = 2 + words.filter(w => text.includes(w)).length * 2 + (norm(title).includes(words[0] || '#') ? 3 : 0) + (d.endsWith('.es') || d.endsWith('.com') ? 1 : 0);
    if (parked) score = 1;
    return { domain: d, finalHost, title, live: true, parked, score };
  }));
  return res.filter(Boolean).sort((a, b) => b.score - a.score);
}

// ---------- noticias (Google News RSS, en español) ----------
async function googleNews(term) {
  const r = await safe(fetch(`https://news.google.com/rss/search?q=${enc('"' + term + '"')}&hl=es&gl=ES&ceid=ES:es`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) }), null);
  if (!r || !r.ok) return [];
  const xml = await r.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 15).map(m => {
    const it = m[1], g = re => decode((it.match(re) || [])[1]);
    const date = g(/<pubDate>([\s\S]*?)<\/pubDate>/); const d = date ? new Date(date) : null;
    return { title: g(/<title>([\s\S]*?)<\/title>/).replace(/\s+-\s+[^-]+$/, ''), url: g(/<link>([\s\S]*?)<\/link>/), source: g(/<source[^>]*>([\s\S]*?)<\/source>/), date: d && !isNaN(d) ? d.toISOString().slice(0, 10) : null };
  }).filter(n => n.title && n.url);
}

// ---------- menciones en Wikipedia ----------
async function wikiMentions(term) {
  const r = await safe(json(`https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc('"' + term + '"')}&srlimit=5&format=json&origin=*`), null);
  return ((r && r.query && r.query.search) || []).map(s => ({ title: s.title, snippet: decode(s.snippet.replace(/<[^>]+>/g, '')), url: `https://es.wikipedia.org/wiki/${enc(s.title.replace(/ /g, '_'))}` }));
}

// ---------- OpenStreetMap (ubicación de negocios) ----------
async function osm(name) {
  const r = await safe(json(`https://nominatim.openstreetmap.org/search?q=${enc(name)}&countrycodes=es&format=jsonv2&limit=4&addressdetails=1&extratags=1`), []);
  return (r || []).filter(p => ['shop', 'office', 'amenity', 'craft', 'tourism', 'building', 'company', 'commercial'].includes(p.category) || (p.extratags && (p.extratags.website || p.extratags.phone)))
    .map(p => ({ name: p.name || p.display_name.split(',')[0], address: p.display_name, kind: `${p.category}/${p.type}`, website: p.extratags && (p.extratags.website || p.extratags['contact:website']),
      phone: p.extratags && (p.extratags.phone || p.extratags['contact:phone']), hours: p.extratags && p.extratags.opening_hours, url: `https://www.openstreetmap.org/${p.osm_type}/${p.osm_id}` }));
}

// ---------- lo que delatan los registros DNS ----------
const TXT_SERVICES = [
  [/^google-site-verification=/i, 'Google Search Console'], [/^MS=ms\d+/i, 'Microsoft 365'], [/^facebook-domain-verification=/i, 'Meta (Facebook/Instagram) Business'],
  [/^apple-domain-verification=/i, 'Apple'], [/^atlassian-domain-verification=/i, 'Atlassian (Jira/Confluence)'], [/^docusign=/i, 'DocuSign'], [/^adobe-idp-site-verification=/i, 'Adobe'],
  [/^zoom-domain-verification/i, 'Zoom'], [/^stripe-verification=/i, 'Stripe (pagos)'], [/^shopify-verification-code=/i, 'Shopify'], [/^hubspot-developer-verification=|hubspot/i, 'HubSpot'],
  [/^mailchimp|^k1\._domainkey/i, 'Mailchimp'], [/^brevo-code:|^sendinblue-code:/i, 'Brevo (email marketing)'], [/^_?globalsign-domain-verification=/i, 'GlobalSign'], [/^dropbox-domain-verification=/i, 'Dropbox'],
  [/^slack-domain-verification=/i, 'Slack'], [/^notion-domain-verification=|^notion/i, 'Notion'], [/^openai-domain-verification=/i, 'OpenAI'], [/^miro-verification=/i, 'Miro'], [/^yandex-verification/i, 'Yandex'],
  [/^teamviewer-sso-verification=/i, 'TeamViewer'], [/^ahrefs-site-verification/i, 'Ahrefs (SEO)'], [/^cisco-ci-domain-verification=/i, 'Cisco Webex'], [/^wix-verification-code=/i, 'Wix'], [/^v=BIMI1/i, 'BIMI (logo en el correo)'],
];
const SPF_SERVICES = [[/_spf\.google\.com/, 'Google Workspace'], [/spf\.protection\.outlook\.com/, 'Microsoft 365'], [/servers\.mcsv\.net|mailchimp/, 'Mailchimp'], [/sendgrid\.net/, 'SendGrid'],
  [/mailgun\.org/, 'Mailgun'], [/amazonses\.com/, 'Amazon SES'], [/spf\.brevo\.com|sendinblue/, 'Brevo'], [/hubspotemail\.net|_spf\.hubspot/, 'HubSpot'], [/zoho\./, 'Zoho Mail'], [/ovh\./, 'OVH'],
  [/ionos|1and1/, 'IONOS'], [/hostinger/, 'Hostinger'], [/salesforce|exacttarget/, 'Salesforce'], [/mandrillapp/, 'Mandrill'], [/zendesk/, 'Zendesk'], [/freshdesk/, 'Freshdesk'], [/acumbamail/, 'Acumbamail'], [/holded/, 'Holded']];
const NS_PROV = [[/cloudflare/, 'Cloudflare'], [/awsdns/, 'Amazon Route 53'], [/azure-dns/, 'Microsoft Azure'], [/googledomains|google\.com/, 'Google'], [/ovh\./, 'OVH'], [/ionos|ui-dns/, 'IONOS'],
  [/dondominio/, 'DonDominio'], [/arsys/, 'Arsys'], [/hostinger/, 'Hostinger'], [/godaddy|domaincontrol/, 'GoDaddy'], [/raiolanetworks/, 'Raiola Networks'], [/webempresa/, 'Webempresa'], [/siteground/, 'SiteGround'], [/nominalia/, 'Nominalia']];
async function dnsIntel(domain) {
  const [txt, ns, mx, a] = await Promise.all([safe(dns.resolveTxt(domain), []), safe(dns.resolveNs(domain), []), safe(dns.resolveMx(domain), []), safe(dns.resolve4(domain), [])]);
  const flat = txt.map(t => t.join(''));
  const services = new Set();
  for (const t of flat) for (const [re, n] of TXT_SERVICES) if (re.test(t)) services.add(n);
  const spf = flat.find(t => /^v=spf1/i.test(t)) || '';
  for (const [re, n] of SPF_SERVICES) if (re.test(spf)) services.add(n);
  const mxs = mx.map(m => m.exchange).join(' ');
  for (const [re, n] of SPF_SERVICES) if (re.test(mxs)) services.add(n);
  if (/google\.com|googlemail/i.test(mxs)) services.add('Google Workspace'); if (/outlook\.com/i.test(mxs)) services.add('Microsoft 365');
  const nsProv = (NS_PROV.find(([re]) => re.test(ns.join(' '))) || [])[1] || (ns[0] || null);
  return { services: [...services], ns, nsProvider: nsProv, ips: a };
}

// ---------- dueño de la IP (RDAP) ----------
async function ipOwner(ip) {
  const r = await safe(json(`https://rdap.org/ip/${ip}`, { timeout: 8000 }), null); if (!r) return null;
  const ent = (r.entities || []).find(e => (e.roles || []).some(x => /registrant|administrative/.test(x))) || (r.entities || [])[0];
  const fn = ent && ent.vcardArray ? ((ent.vcardArray[1] || []).find(v => v[0] === 'fn') || [])[3] : null;
  return { name: r.name, org: fn, country: r.country, range: r.startAddress && `${r.startAddress} – ${r.endAddress}` };
}

// ---------- historial en el archivo de Internet ----------
async function waybackStats(domain) {
  const r = await safe(json(`https://web.archive.org/cdx/search/cdx?url=${enc(domain)}&output=json&fl=timestamp&collapse=timestamp:6&limit=2000`, { timeout: 15000 }), null);
  if (!r || r.length < 2) return null;
  const ts = r.slice(1).map(x => x[0]); const f = s => `${s.slice(0, 4)}-${s.slice(4, 6)}`;
  return { months: ts.length, first: f(ts[0]), last: f(ts[ts.length - 1]) };
}

// ---------- nota de seguridad (servicio escáner interno) ----------
async function securityGrade(domain) {
  const base = process.env.ESCANER_INTERNAL; if (!base) return null;
  try {
    const r = await fetch(`${base}/analizar`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `dominio=${enc(domain)}`, signal: AbortSignal.timeout(8000) });
    const loc = r.headers.get('location'); const id = loc && loc.split('/').pop(); if (!id) return null;
    for (let i = 0; i < 30; i++) {
      const s = await (await fetch(`${base}/api/resultado/${id}`, { signal: AbortSignal.timeout(5000) })).json();
      if (s.status === 'hecho') return { ...s, url: `${process.env.ESCANER_PUBLIC || 'https://escaner.civicloud.es'}/informe/${id}` };
      if (s.status === 'error' || s.status === 'no-existe') return null;
      await new Promise(ok => setTimeout(ok, 2000));
    }
  } catch { return null; }
  return null;
}

module.exports = { discoverDomains, googleNews, wikiMentions, osm, dnsIntel, ipOwner, waybackStats, securityGrade, norm };
