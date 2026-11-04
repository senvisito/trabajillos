// Guías SEO: responden lo que la gente busca en Google y terminan con un "publica gratis".
// Texto propio, sin datos inventados. Cada guía enlaza a su categoría.
module.exports = [
  { slug: 'llamada-falsa-microsoft-soporte-tecnico', cat: 'virus-seguridad',
    title: 'Te llama "Microsoft" diciendo que tienes un virus: qué hacer',
    desc: 'Microsoft no llama para avisar de virus. Cómo reconocer la estafa del falso soporte técnico y qué hacer si ya les dejaste entrar en tu ordenador.',
    body: `<p>Suena el teléfono, alguien dice ser de Microsoft (o de "Windows", o de tu compañía de internet) y te cuenta que tu ordenador está enviando errores o tiene un virus. Te pide que instales un programa para "ayudarte". <b>Es una estafa.</b> Microsoft no llama a particulares para avisar de virus.</p>
<h2>Cómo reconocerla</h2><ul><li>Te llaman ellos, sin que tú hayas pedido nada.</li><li>Te meten prisa: "si cuelga perderá sus datos".</li><li>Te piden instalar AnyDesk, TeamViewer o similar.</li><li>Al final piden pagar, o que entres en tu banco "para comprobar".</li></ul>
<h2>Si ya les dejaste entrar</h2><ol><li>Desconecta el ordenador de internet (quita el cable o apaga el wifi).</li><li>Desde otro dispositivo, cambia la contraseña del banco y del correo.</li><li>Llama a tu banco si entraste en la banca online o diste datos de tarjeta.</li><li>Desinstala el programa de control remoto que te hicieron instalar.</li><li>Haz que un técnico revise el equipo: pueden haber dejado otro acceso escondido.</li></ol>
<p>También puedes llamar gratis al <b>017</b>, la línea de ayuda en ciberseguridad de INCIBE.</p>` },
  { slug: 'sms-falso-banco-paquete', cat: 'virus-seguridad',
    title: 'SMS falso del banco o de un paquete: cómo saberlo y qué hacer si pinchaste',
    desc: 'El smishing es la estafa más común por móvil. Señales para detectar un SMS falso y pasos si ya pulsaste el enlace o metiste tus datos.',
    body: `<p>"Su paquete está retenido, pague 1,99 €", "Hemos bloqueado su tarjeta, verifique aquí". Son SMS falsos (<i>smishing</i>). El objetivo es que metas tus datos en una web que imita a la real.</p>
<h2>Señales de alarma</h2><ul><li>Enlaces acortados o con dominios raros que no son los de tu banco o la empresa de envíos.</li><li>Urgencia y amenazas ("hoy", "bloqueo", "multa").</li><li>Te piden datos de tarjeta o códigos que te llegan por SMS.</li></ul>
<h2>Si ya pinchaste</h2><ol><li>Si solo abriste el enlace y no escribiste nada, cierra la página y borra el SMS.</li><li>Si metiste datos del banco o tarjeta, llama ya a tu banco para bloquearla.</li><li>Si instalaste una app que te pidió el mensaje, desinstálala y revisa el móvil.</li><li>Cambia contraseñas desde otro dispositivo.</li></ol>
<p>Ante la duda, entra siempre en la app oficial de tu banco escribiendo tú la dirección, nunca desde el enlace del mensaje.</p>` },
  { slug: 'ordenador-lento-que-hacer', cat: 'reparacion-ordenadores',
    title: 'Mi ordenador va lento: 7 cosas que puedes probar antes de llamar a un técnico',
    desc: 'Pasos sencillos para acelerar un ordenador lento con Windows y cuándo merece la pena un técnico (o cambiar a SSD).',
    body: `<ol><li><b>Reinicia de verdad.</b> "Apagar" en Windows a veces no reinicia del todo. Usa "Reiniciar".</li>
<li><b>Mira qué consume.</b> Ctrl + Mayús + Esc abre el Administrador de tareas. Ordena por CPU, memoria y disco.</li>
<li><b>Quita programas del inicio.</b> En la pestaña "Inicio" del Administrador de tareas desactiva lo que no necesites al arrancar.</li>
<li><b>Libera espacio.</b> Con el disco casi lleno todo va lento. Busca "Liberador de espacio en disco".</li>
<li><b>Actualiza Windows</b> y reinicia cuando termine.</li>
<li><b>Pasa un antivirus.</b> El de Windows (Microsoft Defender) es suficiente para un análisis completo.</li>
<li><b>Desinstala lo que no uses</b>, sobre todo "optimizadores" y barras de navegador.</li></ol>
<h2>Cuándo llamar a un técnico</h2><p>Si el disco aparece al 100 % casi siempre, es muy probable que sea un disco mecánico antiguo. Cambiarlo por un SSD es de las mejoras que más se notan en un ordenador de hace unos años, y un técnico puede pasar todo tal cual al disco nuevo.</p>` },
  { slug: 'wifi-lento-o-se-corta', cat: 'redes-wifi',
    title: 'El wifi va lento o se corta en casa: causas y soluciones',
    desc: 'Por qué el wifi no llega a todas las habitaciones o se corta, y qué soluciones funcionan: ubicación del router, bandas, repetidores y mesh.',
    body: `<h2>Lo primero</h2><ul><li>Haz un test de velocidad con cable y luego con wifi al lado del router. Si con cable también va lento, el problema es la línea: llama a tu compañía.</li>
<li>Reinicia el router (desenchufa 30 segundos).</li><li>El router no debe estar dentro de un mueble, en el suelo ni detrás de la tele.</li></ul>
<h2>Si no llega a algunas habitaciones</h2><p>Las paredes gruesas y los pisos alargados son el problema típico. Los repetidores baratos suelen dar problemas; un sistema <b>mesh</b> o un punto de acceso por cable funciona mucho mejor.</p>
<h2>2,4 GHz o 5 GHz</h2><p>La de 5 GHz es más rápida pero llega menos lejos. La de 2,4 GHz atraviesa mejor las paredes pero hay más interferencias en edificios con muchos vecinos.</p>
<p>Un técnico puede medir la cobertura piso por piso y decirte qué solución necesitas antes de comprar nada.</p>` },
  { slug: 'recuperar-fotos-borradas', cat: 'recuperar-datos',
    title: 'Cómo recuperar fotos o archivos borrados (y qué NO hacer)',
    desc: 'Si has borrado fotos o se ha estropeado un disco, lo que hagas en los primeros minutos decide si se pueden recuperar.',
    body: `<h2>Lo más importante: deja de usar ese disco</h2><p>Cuando borras un archivo, el espacio queda libre para escribir otra cosa encima. Cada foto nueva, descarga o programa que instales puede sobrescribir lo que quieres recuperar.</p>
<h2>Primero mira aquí</h2><ul><li>Papelera de reciclaje (Windows) o Papelera (Mac).</li><li>Google Fotos, iCloud u OneDrive: tienen carpeta de "eliminados recientemente" durante un tiempo.</li><li>En el móvil: álbum "Eliminado recientemente".</li></ul>
<h2>Qué NO hacer</h2><ul><li>No instales programas de recuperación en el mismo disco donde estaban los archivos.</li><li>Si el disco hace ruidos (clics), apágalo y no lo vuelvas a encender: cada intento puede empeorarlo.</li><li>No lo abras ni lo metas en el congelador.</li></ul>
<p>Un técnico de recuperación trabaja sobre una copia del disco para no dañar el original.</p>` },
  { slug: 'whatsapp-instagram-hackeado', cat: 'virus-seguridad',
    title: 'Me han robado la cuenta de WhatsApp o Instagram: qué hacer ya',
    desc: 'Pasos para recuperar una cuenta robada de WhatsApp o Instagram y evitar que vuelva a pasar con la verificación en dos pasos.',
    body: `<h2>WhatsApp</h2><ol><li>Abre WhatsApp y registra de nuevo tu número: te llegará un código por SMS. Al verificar, se cierra la sesión del otro.</li>
<li>Si te pide un PIN de verificación en dos pasos que no pusiste tú, tendrás que esperar el plazo que indique la app.</li><li>Avisa a tus contactos de que no hagan caso a mensajes pidiendo dinero o códigos.</li><li>Activa la verificación en dos pasos en Ajustes → Cuenta.</li></ol>
<h2>Instagram</h2><ol><li>En la pantalla de inicio de sesión pulsa "¿Necesitas más ayuda?" y sigue el proceso de recuperación.</li><li>Revisa si te ha llegado un correo de Instagram avisando de un cambio de correo: suele incluir un enlace para deshacerlo.</li><li>Cuando entres, cambia la contraseña, revisa los dispositivos conectados y activa la autenticación en dos pasos.</li></ol>
<p><b>Nunca</b> le des a nadie un código que te llegue por SMS, aunque te escriba un amigo: puede que su cuenta también esté robada.</p>` },
];
