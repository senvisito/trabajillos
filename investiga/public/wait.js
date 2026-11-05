(function(){var el=document.getElementById('wait');if(!el)return;var id=el.dataset.id,p=document.getElementById('prog');
function tick(){fetch('/api/informe/'+id,{cache:'no-store'}).then(function(r){return r.json()}).then(function(s){
if(s.status==='hecho'||s.status==='error'){location.reload();return}if(s.progress)p.textContent=s.progress+'…';setTimeout(tick,1500)}).catch(function(){setTimeout(tick,3000)})}tick()})();
