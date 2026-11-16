// Contenido de la landing. Todo el texto vive acá para editarlo sin tocar componentes.

export const HERO = {
  eyebrow: 'Plataforma para countries, barrios y edificios',
  title: 'Gestione su Country, Barrio o Edificio desde un único lugar',
  subtitle: 'Control de accesos, expensas, residentes, amenities, reservas, seguridad y comunicación en una sola plataforma.',
};

/** @type {{ icon: string, title: string, text: string }[]} */
export const BENEFITS = [
  { icon: 'trees', title: 'Countries', text: 'Lotes, propietarios y familias de todo el country en un mismo registro.' },
  { icon: 'shieldCheck', title: 'Seguridad', text: 'Guardias, rondas con NFC/QR y alertas cuando un punto queda sin marcar.' },
  { icon: 'qr', title: 'Visitantes', text: 'Invitaciones con QR y autorización en tiempo real desde el celular.' },
  { icon: 'receipt', title: 'Expensas', text: 'Liquidaciones importadas desde Excel, saldos y recibos al instante.' },
  { icon: 'waves', title: 'Amenities', text: 'Club house, piscinas y quinchos con cupos y reglas de uso.' },
  { icon: 'calendar', title: 'Reservas', text: 'Calendario con disponibilidad real, aprobación y pago online.' },
  { icon: 'building', title: 'Edificios', text: 'Unidades funcionales, cocheras y espacios comunes por torre.' },
  { icon: 'briefcase', title: 'Administración', text: 'Un panel para la administración con permisos por rol.' },
  { icon: 'scale', title: 'Consorcio', text: 'Historial de cada decisión con auditoría completa.' },
  { icon: 'card', title: 'Pagos', text: 'Transferencias con comprobante, efectivo y MercadoPago.' },
  { icon: 'message', title: 'Reclamos', text: 'Cada reclamo con responsable, estado y seguimiento.' },
  { icon: 'elevator', title: 'Ascensores', text: 'Mantenimientos programados y avisos a los residentes.' },
  { icon: 'home', title: 'Barrios cerrados', text: 'Calles internas, lotes y servicios bajo una misma vista.' },
  { icon: 'gate', title: 'Accesos', text: 'Entradas y salidas trazables, con patente y DNI.' },
  { icon: 'camera', title: 'Vigilancia', text: 'Botón de emergencia con ubicación y aviso inmediato a la guardia.' },
  { icon: 'party', title: 'Eventos', text: 'Agenda de la comunidad con invitados pre-autorizados.' },
  { icon: 'ball', title: 'Deportes', text: 'Canchas de tenis, pádel y fútbol con turnos online.' },
  { icon: 'megaphone', title: 'Comunicación', text: 'Avisos push a todos o solo a quien corresponde.' },
];

export const FEATURES = [
  { icon: 'users', title: 'Residentes', text: 'Ficha de cada residente con su grupo familiar.' },
  { icon: 'key', title: 'Propietarios', text: 'Alta por lote y permisos para gestionar su hogar.' },
  { icon: 'user', title: 'Inquilinos', text: 'Residentes habilitados por el propietario, con vigencia.' },
  { icon: 'wallet', title: 'Expensas', text: 'Saldos, vencimientos, recibos y pagos sin parciales.' },
  { icon: 'calendar', title: 'Reservas', text: 'Cupos, horarios, anticipación y tope semanal por lote.' },
  { icon: 'gate', title: 'Accesos', text: 'Registro de entradas y salidas desde la guardia.' },
  { icon: 'shield', title: 'Seguridad', text: 'Rondas, tablero en vivo y alertas al supervisor.' },
  { icon: 'package', title: 'Paquetería', text: 'Recepción de envíos con aviso al residente.' },
  { icon: 'qr', title: 'Visitas', text: 'QR con vigencia o aprobación en el momento.' },
  { icon: 'party', title: 'Eventos', text: 'Listas de invitados y accesos especiales.' },
  { icon: 'file', title: 'Documentación', text: 'Reglamentos, actas y planos siempre a mano.' },
  { icon: 'message', title: 'Reclamos', text: 'Seguimiento con estados y responsables.' },
  { icon: 'megaphone', title: 'Comunicaciones', text: 'Notificaciones push y mensajes segmentados.' },
  { icon: 'store', title: 'Marketplace interno', text: 'Servicios y emprendimientos entre vecinos.' },
];

// Datos simulados para el carousel
export const SLIDES = [
  { asset: 'country-aereo', category: 'Countries', name: 'Country Los Álamos', location: 'Pilar, Buenos Aires', lots: 420,
    amenities: ['Club house', 'Piscinas', 'Golf', 'Tenis'] },
  { asset: 'club-house', category: 'Barrios Privados', name: 'Barrio Valle Alto', location: 'Yerba Buena, Tucumán', lots: 180,
    amenities: ['Club house', 'Piscina climatizada', 'Senderos'] },
  { asset: 'torres', category: 'Torres Premium', name: 'Torres del Puerto', location: 'Puerto Madero, CABA', lots: 312,
    amenities: ['Gimnasio', 'SUM', 'Cocheras', 'Seguridad 24 h'], unitsLabel: 'unidades' },
  { asset: 'torre-lobby', category: 'Complejos Residenciales', name: 'Complejo Plaza Norte', location: 'Rosario, Santa Fe', lots: 540,
    amenities: ['Lobby', 'Coworking', 'Plaza central'], unitsLabel: 'unidades' },
  { asset: 'barrio-lotes', category: 'Barrios Privados', name: 'Barrio Las Lomas', location: 'Canning, Buenos Aires', lots: 260,
    amenities: ['Lagos', 'Ciclovía', 'Club house'] },
];

export const GALLERY_FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'countries', label: 'Countries' },
  { id: 'edificios', label: 'Edificios' },
  { id: 'barrios', label: 'Barrios' },
  { id: 'premium', label: 'Premium' },
];

export const VARIANT_LABEL = { day: 'Día', sunset: 'Atardecer', night: 'Noche', premium: 'Premium', future: 'Futurista' };

// ⚠️ EJEMPLOS ILUSTRATIVOS: reemplazar por testimonios reales (con autorización) antes de publicar.
export const TESTIMONIALS = [
  { name: 'Laura Méndez', role: 'Administradora', org: 'Country Los Álamos', rating: 5,
    quote: 'Pasamos de planillas y grupos de WhatsApp a tener todo en un lugar. La guardia registra cada ingreso y los vecinos autorizan desde el celular.' },
  { name: 'Martín Ferreyra', role: 'Presidente del consorcio', org: 'Torres del Puerto', rating: 5,
    quote: 'Las expensas se concilian solas: el vecino sube el comprobante y lo aprobamos en un clic. Bajó muchísimo la morosidad.' },
  { name: 'Carolina Ruiz', role: 'Jefa de seguridad', org: 'Barrio Valle Alto', rating: 5,
    quote: 'El tablero de rondas en vivo nos cambió la operación. Si falta un punto, me entero en el momento.' },
  { name: 'Diego Paz', role: 'Propietario', org: 'Barrio Las Lomas', rating: 4,
    quote: 'Reservo la cancha de tenis, pago y listo. Y cuando llega una visita me avisa el teléfono.' },
];

// ⚠️ CIFRAS DE EJEMPLO: reemplazar por métricas reales antes de publicar.
export const STATS = [
  { value: 120, suffix: '+', label: 'Countries y edificios gestionados' },
  { value: 38000, suffix: '+', label: 'Residentes activos' },
  { value: 250000, suffix: '+', label: 'Reservas procesadas' },
  { value: 4200000, suffix: '+', label: 'Accesos registrados' },
];

export const FOOTER = [
  { title: 'Producto', links: [['Funcionalidades', '#funcionalidades'], ['Panel', '#panel'], ['Galería', '#galeria'], ['Seguridad', '#beneficios']] },
  { title: 'Soluciones', links: [['Countries', '#comunidades'], ['Barrios privados', '#comunidades'], ['Edificios', '#comunidades'], ['Complejos', '#comunidades']] },
  { title: 'Empresa', links: [['Clientes', '#testimonios'], ['Cifras', '#cifras'], ['Solicitar demo', '#demo']] },
  { title: 'Soporte', links: [['Ingresar', '/login'], ['Documentación API', '/api/docs'], ['Estado del servicio', '/api/health']] },
];

export const CONTACT = { email: 'hola@admincountrys.com', phone: '+54 11 0000-0000', city: 'Buenos Aires, Argentina' };
