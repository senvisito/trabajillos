// Catálogo inicial: solo informática y solo València. Ampliar aquí más adelante.
const CATEGORIES = {
  'reparacion-ordenadores': { name: 'Reparar ordenador o portátil', short: 'Reparación de ordenadores', price: [30, 90],
    words: ['ordenador', 'portatil', 'portátil', 'pc', 'no enciende', 'lento', 'pantalla', 'teclado', 'disco', 'ventilador', 'calienta', 'pantallazo', 'reparar', 'arreglar', 'formatear', 'windows'] },
  'virus-seguridad': { name: 'Virus, estafas y seguridad', short: 'Virus y seguridad', price: [40, 120],
    words: ['virus', 'hackeado', 'hackear', 'estafa', 'phishing', 'malware', 'ransomware', 'contraseña', 'robado', 'cuenta', 'seguridad', 'antivirus', 'secuestro'] },
  'redes-wifi': { name: 'Wi-Fi, red e internet', short: 'Redes y Wi-Fi', price: [40, 150],
    words: ['wifi', 'wi-fi', 'internet', 'router', 'red', 'cable', 'repetidor', 'cobertura', 'conexión', 'conexion', 'switch', 'mesh', 'fibra'] },
  'recuperar-datos': { name: 'Recuperar datos y copias de seguridad', short: 'Recuperación de datos', price: [50, 250],
    words: ['recuperar', 'borrado', 'fotos', 'copia', 'backup', 'perdido', 'pendrive', 'usb', 'nas', 'nube', 'datos'] },
  'montaje-pc': { name: 'Montar o mejorar un PC', short: 'Montaje de PC', price: [40, 120],
    words: ['montar', 'montaje', 'gaming', 'gráfica', 'grafica', 'ram', 'ssd', 'ampliar', 'mejorar', 'componentes', 'presupuesto pc'] },
  'impresoras': { name: 'Impresoras y periféricos', short: 'Impresoras', price: [30, 80],
    words: ['impresora', 'imprime', 'escáner', 'escaner', 'tinta', 'toner', 'tóner', 'periférico'] },
  'moviles-tablets': { name: 'Móviles y tablets', short: 'Móviles y tablets', price: [25, 90],
    words: ['móvil', 'movil', 'iphone', 'android', 'tablet', 'ipad', 'whatsapp', 'teléfono', 'telefono'] },
  'web-tiendas': { name: 'Páginas web y tiendas online', short: 'Páginas web', price: [150, 1500],
    words: ['web', 'página', 'pagina', 'tienda online', 'wordpress', 'dominio', 'hosting', 'seo', 'woocommerce', 'shopify'] },
  'soporte-empresas': { name: 'Soporte informático para empresas', short: 'Soporte a empresas', price: [60, 400],
    words: ['empresa', 'oficina', 'servidor', 'empleados', 'mantenimiento', 'correo', 'microsoft 365', 'office', 'dominio', 'sage', 'erp', 'autónomo', 'autonomo'] },
  'clases-ayuda': { name: 'Clases y ayuda con la tecnología', short: 'Clases de informática', price: [15, 40],
    words: ['clase', 'enseñar', 'aprender', 'mayor', 'abuelo', 'abuela', 'padre', 'madre', 'configurar', 'ayuda', 'excel', 'curso'] },
};

// Distritos y barrios de València (selección inicial para SEO y filtros).
const BARRIOS = ['Ciutat Vella', 'Eixample', 'Russafa', 'Extramurs', 'Campanar', 'La Saïdia', 'El Pla del Real',
  'Benimaclet', 'Algirós', 'Camins al Grau', 'Poblats Marítims', 'El Cabanyal', 'Patraix', 'Jesús', 'Quatre Carreres',
  'L\'Olivereta', 'Benicalap', 'Rascanya', 'Orriols', 'Malilla', 'Benimàmet', 'Toda València (remoto)'];

const slugify = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

module.exports = { CATEGORIES, BARRIOS, slugify };
