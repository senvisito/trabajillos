(function(){var p=document.getElementById('print');if(p)p.onclick=function(){document.querySelectorAll('details').forEach(function(d){d.open=true});window.print()};
var c=document.getElementById('copy');if(c)c.onclick=function(){navigator.clipboard.writeText(c.dataset.url).then(function(){c.textContent='¡Copiado!'})}})();
