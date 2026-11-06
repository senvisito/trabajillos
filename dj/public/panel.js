(function(){var list=document.getElementById('list'),cnt=document.getElementById('count'),last=document.getElementById('last'),player=document.getElementById('player');
var csrf=document.body.dataset.csrf,filter='nueva',data=null,sig='',seen=null,playing=null;
function post(u,b){return fetch(u,{method:'POST',headers:{'content-type':'application/json','x-csrf':csrf},body:JSON.stringify(b||{})}).then(function(r){if(r.status===401)location.reload();return r.json()})}
function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
var SHOPS=[['Beatport','https://www.beatport.com/search?q='],['TIDAL','https://listen.tidal.com/search?q='],['SoundCloud','https://soundcloud.com/search?q='],['Apple Music','https://music.apple.com/es/search?term='],['Bandcamp','https://bandcamp.com/search?q='],['YouTube','https://www.youtube.com/results?search_query=']];
function card(it){var c=el('article','card'+(it.status==='puesta'?' done':'')+(seen&&!seen.has(it.ids[0])?' new':''));
var art;if(it.artwork){art=el('img','art');art.src=it.artwork;art.alt=''}else art=el('div','art','🎵');c.appendChild(art);
var b=el('div');b.appendChild(el('div','ct',it.title));b.appendChild(el('div','ca',it.artist));
var m=el('div','meta');if(it.times>1)m.appendChild(el('span','badge','×'+it.times+' veces'));if(it.tips)m.appendChild(el('span','badge tip','💶 quiere dar propina'));
m.appendChild(el('span',null,it.ago));if(it.people.length)m.appendChild(el('span',null,'Pide: '+it.people.join(', ')));b.appendChild(m);
it.messages.forEach(function(x){b.appendChild(el('div','msg','💬 '+(x.who?x.who+': ':'')+x.text))});
var acts=el('div','acts'),q=it.artist+' - '+it.title;
if(it.preview){var p=el('button','btn small',playing===it.preview?'⏸ Parar':'▶ Escuchar');p.onclick=function(){if(playing===it.preview){player.pause();playing=null}else{player.src=it.preview;player.play();playing=it.preview}draw()};acts.appendChild(p)}
var cp=el('button','btn small','📋 Copiar para buscar');cp.onclick=function(){navigator.clipboard.writeText(q).then(function(){cp.textContent='✓ Copiado: pégalo en tu programa DJ'})};acts.appendChild(cp);
var st=el('button','btn small primary',it.status==='puesta'?'↩ Pendiente':'✓ Puesta');st.onclick=function(){post('/panel/api/estado',{ids:it.ids,status:it.status==='puesta'?'nueva':'puesta'}).then(load)};acts.appendChild(st);
var del=el('button','btn small danger','🗑 Borrar');del.onclick=function(){post('/panel/api/borrar',{ids:it.ids}).then(load)};acts.appendChild(del);b.appendChild(acts);
var f=el('div','find');f.appendChild(el('span',null,'¿No la tienes? Búscala en:'));SHOPS.forEach(function(s){var a=el('a',null,s[0]);a.href=s[1]+encodeURIComponent(q);a.target='_blank';a.rel='noopener';f.appendChild(a)});b.appendChild(f);
c.appendChild(b);return c}
function draw(){if(!data)return;var items=data.items.filter(function(i){return filter==='todas'||i.status===filter});
var pend=data.items.filter(function(i){return i.status==='nueva'}).reduce(function(n,i){return n+i.times},0);cnt.textContent=pend;document.title='('+pend+') Peticiones';
list.innerHTML='';if(!items.length){list.appendChild(el('p','muted',filter==='nueva'?'No hay peticiones pendientes. 🎧':'Nada por aquí.'));return}
items.forEach(function(i){list.appendChild(card(i))})}
function load(){fetch('/panel/api/peticiones',{cache:'no-store'}).then(function(r){if(r.status===401){location.reload();return null}return r.json()}).then(function(d){if(!d)return;
var s=JSON.stringify(d.items.map(function(i){return [i.ids,i.status,i.times]}));last.textContent='actualizado '+new Date().toLocaleTimeString('es-ES');
if(s!==sig){var first=data===null;data=d;sig=s;draw();if(first)seen=new Set(d.items.flatMap(function(i){return i.ids}));else setTimeout(function(){seen=new Set(d.items.flatMap(function(i){return i.ids}))},8000)}else{data=d;}}).catch(function(){last.textContent='sin conexión, reintentando…'})}
document.querySelectorAll('.tab').forEach(function(t){t.onclick=function(){document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('active')});t.classList.add('active');filter=t.dataset.f;draw()}});
document.getElementById('clearAll').onclick=function(){if(confirm('¿Borrar TODAS las peticiones?'))post('/panel/api/borrar-todas').then(load)};
var ob=document.getElementById('openBtn');ob.onclick=function(){var open=ob.dataset.open!=='1';post('/panel/api/abrir',{open:open}).then(function(){ob.dataset.open=open?'1':'0';ob.textContent=open?'🟢 Abiertas':'🔴 Cerradas';ob.className='btn '+(open?'on':'off')})};
player.onended=function(){playing=null;draw()};load();setInterval(load,5000)})();
