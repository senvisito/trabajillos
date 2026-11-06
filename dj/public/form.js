(function(){var t=document.getElementById('title'),a=document.getElementById('artist'),ul=document.getElementById('sug'),pk=document.getElementById('picked'),ab=document.getElementById('artistBox');
if(!t)return;var timer,items=[],act=-1,ctrl;
function set(id,v){document.getElementById(id).value=v||''}
function close(){ul.hidden=true;act=-1}
function render(){ul.innerHTML='';items.forEach(function(s,i){var li=document.createElement('li');if(i===act)li.className='act';
if(s.artwork){var im=document.createElement('img');im.src=s.artwork;im.alt='';li.appendChild(im)}var d=document.createElement('div');d.textContent=s.title;var sp=document.createElement('span');sp.textContent=s.artist;d.appendChild(sp);li.appendChild(d);
li.addEventListener('mousedown',function(e){e.preventDefault();pick(s)});ul.appendChild(li)});ul.hidden=!items.length}
function pick(s){t.value=s.title;a.value=s.artist;set('artwork',s.artwork);set('preview',s.preview);set('ext_id',s.id);
document.getElementById('pimg').src=s.artwork||'';document.getElementById('ptitle').textContent=s.title;document.getElementById('partist').textContent=s.artist;
pk.hidden=false;ab.hidden=true;close()}
document.getElementById('unpick').onclick=function(){pk.hidden=true;ab.hidden=false;set('artwork');set('preview');set('ext_id');t.focus()};
t.addEventListener('input',function(){set('artwork');set('preview');set('ext_id');pk.hidden=true;ab.hidden=false;clearTimeout(timer);var q=t.value.trim();if(q.length<2){close();return}
timer=setTimeout(function(){if(ctrl)ctrl.abort();ctrl=new AbortController();fetch('/api/buscar?q='+encodeURIComponent(q),{signal:ctrl.signal}).then(function(r){return r.json()}).then(function(r){items=r.slice(0,7);act=-1;render()}).catch(function(){})},220)});
t.addEventListener('keydown',function(e){if(ul.hidden)return;if(e.key==='ArrowDown'){act=Math.min(act+1,items.length-1);render();e.preventDefault()}else if(e.key==='ArrowUp'){act=Math.max(act-1,0);render();e.preventDefault()}else if(e.key==='Enter'&&act>=0){pick(items[act]);e.preventDefault()}else if(e.key==='Escape')close()});
t.addEventListener('blur',function(){setTimeout(close,150)});
document.getElementById('req').addEventListener('submit',function(){var b=this.querySelector('.send');b.disabled=true;b.textContent='Enviando…'})})();
