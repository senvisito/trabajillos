// Asistente al publicar: analiza el texto y rellena tipo, título, urgencia y precio orientativo.
(function () {
  const desc = document.getElementById('desc'); if (!desc) return;
  const box = document.getElementById('assist');
  const csrf = document.querySelector('input[name=_csrf]').value;
  const $ = id => document.getElementById(id);
  let timer, touched = { title: !!$('title').value };
  $('title').addEventListener('input', () => { touched.title = true; });
  async function run() {
    const text = desc.value.trim(); if (text.length < 10) { box.hidden = true; return; }
    try {
      const r = await fetch('/api/asistente', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf': csrf }, body: JSON.stringify({ text }) });
      const a = await r.json(); if (!a.ok) return;
      $('category').value = a.category; $('urgency').value = a.urgency; $('modality').value = a.modality;
      if (!touched.title) $('title').value = a.title;
      if (!$('bmin').value && !$('bmax').value) { $('bmin').placeholder = a.price[0]; $('bmax').placeholder = a.price[1]; }
      box.textContent = '';
      const p = document.createElement('p'); p.innerHTML = '<b>Asistente:</b> ';
      p.append(`Parece «${a.categoryName}». Suele costar entre ${a.price[0]} y ${a.price[1]} €.`); box.append(p);
      if (a.tips.length) { const ul = document.createElement('ul'); a.tips.forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.append(li); });
        const q = document.createElement('p'); q.textContent = 'Si lo añades, te responderán mejor:'; box.append(q, ul); }
      box.hidden = false;
    } catch (e) { /* sin asistente, el formulario sigue funcionando */ }
  }
  desc.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 600); });
  if (desc.value) run();
})();
