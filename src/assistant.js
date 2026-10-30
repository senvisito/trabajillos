// "Harvey personal": asistente que ayuda a clientes a publicar bien y a profesionales a responder mejor.
// Funciona gratis con reglas. Si se define ANTHROPIC_API_KEY, mejora los textos con IA (opcional).
const { CATEGORIES } = require('./data');

const STRONG = new Set(['virus', 'hackeado', 'malware', 'ransomware', 'phishing', 'estafa', 'wifi', 'wi-fi', 'router', 'impresora', 'recuperar', 'montar', 'tienda online', 'wordpress', 'clase', 'iphone', 'android']);

function classify(text) {
  const t = (text || '').toLowerCase();
  let best = 'reparacion-ordenadores', score = 0;
  for (const [key, c] of Object.entries(CATEGORIES)) {
    const s = c.words.reduce((n, w) => n + (t.includes(w) ? (STRONG.has(w) ? 4 : w.length > 6 ? 2 : 1) : 0), 0);
    if (s > score) { score = s; best = key; }
  }
  const urgent = /(urgente|hoy|ya mismo|cuanto antes|lo antes posible|no puedo trabajar|mañana a primera)/.test(t);
  const remote = /(remoto|a distancia|teamviewer|anydesk|por internet)/.test(t);
  return { category: best, confidence: score, urgency: urgent ? 'urgente' : 'normal', modality: remote ? 'remoto' : 'presencial' };
}

function suggestTitle(text, category) {
  let first = (text || '').split(/[.\n!?]/)[0].trim();
  if (first.length > 70) first = first.slice(0, 70).replace(/[,;:]?\s+\S*$/, '') + '…';
  if (first.length >= 12) return first.charAt(0).toUpperCase() + first.slice(1);
  return CATEGORIES[category].name;
}

// Lo que el asistente le devuelve al cliente al describir su problema.
function analyzeRequest(text) {
  const c = classify(text);
  const cat = CATEGORIES[c.category];
  const questions = [];
  if (!/(marca|modelo|hp|lenovo|asus|acer|dell|apple|mac|samsung|xiaomi|msi)/i.test(text)) questions.push('¿Qué marca y modelo es el equipo?');
  if (!/(desde|hace|ayer|semana|mes)/i.test(text)) questions.push('¿Desde cuándo pasa?');
  if (c.modality === 'presencial') questions.push('¿Te viene bien que vengan a casa u oficina, o prefieres llevarlo?');
  return {
    ...c,
    categoryName: cat.name,
    title: suggestTitle(text, c.category),
    price: cat.price,
    tips: questions.slice(0, 3),
  };
}

// Borrador de respuesta personalizada para un profesional.
function draftReply(job, pro, stats) {
  const exp = stats && stats.done > 0 ? `Llevo ${stats.done} trabajo${stats.done > 1 ? 's' : ''} hecho${stats.done > 1 ? 's' : ''} en Trabajillos` : 'Me dedico a esto en València';
  const where = job.modality === 'remoto' ? 'Lo puedo mirar en remoto hoy mismo.' :
    (pro.barrio && pro.barrio === job.barrio ? `Estoy en ${pro.barrio}, al lado.` : `Me puedo acercar a ${job.barrio}.`);
  const price = job.budget_max ? ` Por lo que cuentas, calculo entre ${job.budget_min || Math.round(job.budget_max / 2)} y ${job.budget_max} €, y te lo confirmo antes de empezar.` : '';
  return `Hola, he leído lo de "${job.title}". ${exp}. ${where}${price} ¿Cuándo te viene bien?`;
}

// Puntuación del ranking: media bayesiana (evita que 1 reseña de 5 estrellas gane a 40 de 4,8) + trabajos hechos.
function rankScore(avg, count, done) {
  const C = 4.0, m = 3;
  const bayes = ((C * m) + (avg || 0) * count) / (m + count);
  return bayes + Math.min(done, 50) * 0.01;
}

// Mejora opcional con IA (solo si hay clave). Si falla, se usa el texto de reglas.
async function improveWithAI(prompt, fallback) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallback;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-haiku-5-5', max_tokens: 300,
        messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return fallback;
    const j = await r.json();
    return (j.content && j.content[0] && j.content[0].text || fallback).trim();
  } catch { return fallback; }
}

module.exports = { analyzeRequest, draftReply, rankScore, classify, improveWithAI };
