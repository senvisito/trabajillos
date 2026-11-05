// Peticiones de red seguras: solo a IPs públicas (evita que alguien use el escáner para atacar la red interna del servidor).
const dns = require('dns').promises;
const net = require('net');
const http = require('http');
const https = require('https');
const tls = require('tls');

function isPrivate(ip) {
  if (process.env.ALLOW_PRIVATE === '1') return false; // solo para pruebas locales
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return isPrivate(x.slice(7));
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff');
}

// lookup que rechaza IPs privadas (se usa en cada conexión, también tras redirecciones)
function safeLookup(host, opts, cb) {
  dns.lookup(host, { all: true }).then(list => {
    const ok = list.filter(a => !isPrivate(a.address));
    if (!ok.length) return cb(Object.assign(new Error('Dirección no permitida'), { code: 'EPRIVATE' }));
    if (opts && opts.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  }).catch(e => cb(e));
}

const UA = 'Mozilla/5.0 (compatible; EscanerWeb/0.1; +analisis-pasivo)';

// GET con límite de tamaño y tiempo. Devuelve {status, headers, body, url, ms, redirects, rawCookies}
function get(url, { maxBytes = 1.5e6, timeout = 9000, follow = 5, method = 'GET' } = {}) {
  const t0 = Date.now(); const redirects = [];
  return new Promise((resolve, reject) => {
    const go = (u, left) => {
      let parsed; try { parsed = new URL(u); } catch { return reject(new Error('URL no válida')); }
      if (!/^https?:$/.test(parsed.protocol)) return reject(new Error('Protocolo no permitido'));
      if (parsed.port && !['80', '443'].includes(parsed.port)) return reject(new Error('Puerto no permitido'));
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request(parsed, { method, lookup: safeLookup, timeout, headers: { 'user-agent': UA, accept: 'text/html,*/*;q=0.8', 'accept-language': 'es-ES,es;q=0.9' },
        rejectUnauthorized: false }, res => {
        const loc = res.headers.location;
        if (loc && res.statusCode >= 300 && res.statusCode < 400 && left > 0) {
          res.resume(); const next = new URL(loc, u).toString(); redirects.push({ from: u, to: next, status: res.statusCode }); return go(next, left - 1);
        }
        const chunks = []; let size = 0;
        res.on('data', c => { size += c.length; if (size > maxBytes) { res.destroy(); } else chunks.push(c); });
        const done = () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8'), url: u, ms: Date.now() - t0, redirects,
          authorized: res.socket && res.socket.authorized, rawCookies: res.headers['set-cookie'] || [] });
        res.on('end', done); res.on('close', done); res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado')));
      req.on('error', reject); req.end();
    };
    go(url, follow);
  });
}

// Certificado y protocolo TLS. versions: comprueba si acepta TLS 1.0/1.1 (protocolos antiguos)
function tlsInfo(host, { minVersion, maxVersion, timeout = 7000 } = {}) {
  return new Promise(resolve => {
    safeLookup(host, {}, (err, ip) => {
      if (err) return resolve({ error: err.message });
      const opts = { host: ip, servername: host, port: 443, rejectUnauthorized: false, timeout };
      if (minVersion) Object.assign(opts, { minVersion, maxVersion, ciphers: 'DEFAULT@SECLEVEL=0' });
      const s = tls.connect(opts, () => {
        const c = s.getPeerCertificate(true) || {};
        const r = { protocol: s.getProtocol(), authorized: s.authorized, authError: s.authorizationError && String(s.authorizationError), ip,
          subject: c.subject, issuer: c.issuer, valid_from: c.valid_from, valid_to: c.valid_to, san: c.subjectaltname, cipher: s.getCipher() };
        s.end(); resolve(r);
      });
      s.on('error', e => resolve({ error: e.code || e.message }));
      s.on('timeout', () => { s.destroy(); resolve({ error: 'timeout' }); });
    });
  });
}

// JSON de APIs públicas conocidas (OSV, WordPress, endoflife, crt.sh)
async function json(url, { body, timeout = 10000 } = {}) {
  const r = await fetch(url, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

module.exports = { get, tlsInfo, json, isPrivate, safeLookup, UA };
