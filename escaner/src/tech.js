// Detección de tecnologías a partir de cabeceras y HTML. Cada detección dice de dónde sale (evidencia).
const SIGS = [
  // [nombre, categoría, test(headers, html) -> versión|true|null]
  ['WordPress', 'CMS', (h, b) => mm(b, /<meta[^>]+generator[^>]+WordPress ?([\d.]+)?/i) || (/\/wp-(content|includes)\//i.test(b) ? true : null)],
  ['Joomla', 'CMS', (h, b) => mm(b, /<meta[^>]+generator[^>]+Joomla!? ?([\d.]+)?/i) || (/\/media\/jui\/|\/components\/com_/i.test(b) ? true : null)],
  ['Drupal', 'CMS', (h, b) => mm(b, /<meta[^>]+generator[^>]+Drupal ?([\d.]+)?/i) || (h['x-generator'] && /drupal/i.test(h['x-generator']) ? true : null) || (/sites\/(default|all)\/(files|themes)/i.test(b) ? true : null)],
  ['PrestaShop', 'Tienda online', (h, b) => /prestashop/i.test(b) || /PrestaShop/i.test(h['powered-by'] || '') ? true : null],
  ['WooCommerce', 'Tienda online', (h, b) => /woocommerce/i.test(b) ? true : null],
  ['Shopify', 'Tienda online', (h, b) => h['x-shopid'] || /cdn\.shopify\.com/i.test(b) ? true : null],
  ['Magento', 'Tienda online', (h, b) => /Mage\.Cookies|static\/version\d+\/frontend/i.test(b) ? true : null],
  ['Wix', 'Creador web', (h, b) => /wix\.com|_wixCIDX|wixstatic/i.test(b) || h['x-wix-request-id'] ? true : null],
  ['Squarespace', 'Creador web', (h, b) => /squarespace/i.test(b) ? true : null],
  ['Webflow', 'Creador web', (h, b) => /webflow/i.test(b) ? true : null],
  ['Elementor', 'Plugin WordPress', (h, b) => mm(b, /elementor(?:-pro)?\/[^"']*?ver=([\d.]+)/i) || (/elementor/i.test(b) ? true : null)],
  ['Yoast SEO', 'Plugin WordPress', (h, b) => mm(b, /Yoast SEO(?: Premium)? plugin v([\d.]+)/i) || (/yoast/i.test(b) ? true : null)],
  ['Contact Form 7', 'Plugin WordPress', (h, b) => mm(b, /contact-form-7\/[^"']*?ver=([\d.]+)/i) || (/contact-form-7/i.test(b) ? true : null)],
  ['jQuery', 'Librería JavaScript', (h, b) => mm(b, /jquery[.-]?([\d]+\.[\d]+\.[\d]+)(?:\.min)?\.js/i) || mm(b, /jquery(?:\.min)?\.js\?ver=([\d.]+)/i) || (/jquery/i.test(b) ? true : null)],
  ['jQuery UI', 'Librería JavaScript', (h, b) => mm(b, /jquery-ui[.-]?([\d]+\.[\d]+\.[\d]+)/i)],
  ['Bootstrap', 'Framework CSS', (h, b) => mm(b, /bootstrap[.-]?([\d]+\.[\d]+\.[\d]+)(?:\.min)?\.(?:css|js)/i) || mm(b, /bootstrap@([\d.]+)/i) || (/bootstrap(\.min)?\.(css|js)/i.test(b) ? true : null)],
  ['React', 'Framework JavaScript', (h, b) => /data-reactroot|react-dom/i.test(b) ? true : null],
  ['Next.js', 'Framework JavaScript', (h, b) => /__NEXT_DATA__|\/_next\//.test(b) || /next\.js/i.test(h['x-powered-by'] || '') ? true : null],
  ['Nuxt', 'Framework JavaScript', (h, b) => /__NUXT__|\/_nuxt\//.test(b) ? true : null],
  ['Vue.js', 'Framework JavaScript', (h, b) => mm(b, /vue@([\d.]+)/i) || (/data-v-[0-9a-f]{8}/.test(b) ? true : null)],
  ['Angular', 'Framework JavaScript', (h, b) => mm(b, /ng-version="([\d.]+)"/i)],
  ['Google Analytics', 'Analítica', (h, b) => /googletagmanager\.com\/gtag|google-analytics\.com\/(analytics|ga)\.js/i.test(b) ? true : null],
  ['Google Tag Manager', 'Analítica', (h, b) => /googletagmanager\.com\/gtm\.js/i.test(b) ? true : null],
  ['Meta Pixel', 'Publicidad', (h, b) => /connect\.facebook\.net\/[^"']*fbevents\.js/i.test(b) ? true : null],
  ['Hotjar', 'Analítica', (h, b) => /static\.hotjar\.com/i.test(b) ? true : null],
  ['Google reCAPTCHA', 'Seguridad', (h, b) => /google\.com\/recaptcha/i.test(b) ? true : null],
  ['Cloudflare', 'CDN / protección', (h) => h['cf-ray'] || /cloudflare/i.test(h.server || '') ? true : null],
  ['Fastly', 'CDN', (h) => /fastly/i.test(h['x-served-by'] || '') || h['x-fastly-request-id'] ? true : null],
  ['Amazon CloudFront', 'CDN', (h) => /cloudfront/i.test(h.via || '') || h['x-amz-cf-id'] ? true : null],
  ['Vercel', 'Alojamiento', (h) => h['x-vercel-id'] ? true : null],
  ['Netlify', 'Alojamiento', (h) => h['x-nf-request-id'] || /netlify/i.test(h.server || '') ? true : null],
  ['LiteSpeed', 'Servidor web', (h) => mm(h.server || '', /LiteSpeed\/?([\d.]+)?/i)],
  ['nginx', 'Servidor web', (h) => mm(h.server || '', /nginx\/?([\d.]+)?/i)],
  ['Apache', 'Servidor web', (h) => mm(h.server || '', /Apache\/?([\d.]+)?/i)],
  ['Microsoft IIS', 'Servidor web', (h) => mm(h.server || '', /Microsoft-IIS\/?([\d.]+)?/i)],
  ['OpenResty', 'Servidor web', (h) => mm(h.server || '', /openresty\/?([\d.]+)?/i)],
  ['PHP', 'Lenguaje', (h) => mm(h['x-powered-by'] || '', /PHP\/?([\d.]+)?/i) || mm(h.server || '', /PHP\/([\d.]+)/i)],
  ['ASP.NET', 'Lenguaje', (h) => mm(h['x-aspnet-version'] || '', /([\d.]+)/) || (/ASP\.NET/i.test(h['x-powered-by'] || '') ? true : null)],
  ['Express', 'Framework', (h) => /Express/i.test(h['x-powered-by'] || '') ? true : null],
  ['OpenSSL', 'Librería', (h) => mm(h.server || '', /OpenSSL\/([\w.]+)/i)],
  ['WP Rocket', 'Caché', (h, b) => /wp-rocket/i.test(b) || h['x-rocket-nginx-serving-static'] ? true : null],
];
function mm(s, re) { const m = String(s).match(re); return m ? (m[1] || true) : null; }

function detect(headers, html) {
  const out = [];
  for (const [name, cat, test] of SIGS) {
    let v = null; try { v = test(headers, html); } catch {}
    if (v) out.push({ name, category: cat, version: typeof v === 'string' ? v : null });
  }
  return out;
}

// Paquetes que podemos consultar en la base de vulnerabilidades OSV (ecosistema npm)
const OSV_NPM = { jQuery: 'jquery', 'jQuery UI': 'jquery-ui', Bootstrap: 'bootstrap', 'Vue.js': 'vue', Angular: '@angular/core' };

module.exports = { detect, OSV_NPM };
