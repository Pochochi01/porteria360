// Genera variantes WebP responsivas de las fotos de /Imagenes.
// Uso: npm run assets   →  public/generated-assets/<categoría>/<id>-<variante>-<ancho>.webp
//                          src/landing/data/assets.json (manifiesto con medidas y placeholder)
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'Imagenes');
const OUT = path.join(ROOT, 'public', 'generated-assets');
const MANIFEST = path.join(ROOT, 'src', 'landing', 'data', 'assets.json');
const WIDTHS = [480, 960, 1440, 1920];

// Clasificación de las fotos originales (revisadas a mano)
const SOURCES = [
  { file: 'barrio-cerrado1.jpg', id: 'country-aereo', category: 'countries', tags: ['countries', 'premium'],
    title: 'Country con piscinas y espacios verdes', alt: 'Vista aérea de un country con casas, piscinas, arboledas y calles internas' },
  { file: 'barrio cerrado3.jpeg', id: 'club-house', category: 'countries', tags: ['countries', 'premium'],
    title: 'Club House y piscinas', alt: 'Club House moderno con dos piscinas, parque y montañas de fondo' },
  { file: 'barrios cerrado2.jpg', id: 'barrio-lotes', category: 'neighborhoods', tags: ['barrios'],
    title: 'Barrio cerrado con lotes', alt: 'Vista aérea de un barrio cerrado con calles curvas y lotes' },
  { file: 'edificio1.jpg', id: 'torres', category: 'buildings', tags: ['edificios', 'premium'],
    title: 'Torres premium', alt: 'Torres de vidrio vistas desde abajo contra un cielo azul' },
  { file: 'edificio2.jpg', id: 'torre-lobby', category: 'buildings', tags: ['edificios', 'premium'],
    title: 'Torre con lobby iluminado', alt: 'Torre residencial de noche con lobby iluminado en tonos cálidos' },
];
// Copias para la portada (hero y CTA final)
const HOME = [
  { from: 'country-aereo', id: 'hero' },
  { from: 'torre-lobby', id: 'cta' },
];

const vignette = (w, h, color, opacity) => Buffer.from(
  `<svg width="${w}" height="${h}"><defs><radialGradient id="g" cx="50%" cy="45%" r="75%">
   <stop offset="55%" stop-color="${color}" stop-opacity="0"/><stop offset="100%" stop-color="${color}" stop-opacity="${opacity}"/>
   </radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
const glow = (w, h, color, opacity) => Buffer.from(
  `<svg width="${w}" height="${h}"><defs><radialGradient id="g" cx="70%" cy="20%" r="60%">
   <stop offset="0%" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/>
   </radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);

// Gradación de color por variante (matrices recomb 3x3 + ajustes)
const VARIANTS = {
  day: (img) => img.modulate({ brightness: 1.04, saturation: 1.08 }),
  night: (img, w, h) => img
    .recomb([[0.35, 0.1, 0.1], [0.1, 0.4, 0.15], [0.15, 0.25, 0.75]])
    .modulate({ brightness: 0.62, saturation: 0.85 })
    .composite([{ input: glow(w, h, '#fbbf24', 0.18), blend: 'screen' }, { input: vignette(w, h, '#020617', 0.7) }]),
  sunset: (img, w, h) => img
    .recomb([[1.08, 0.12, 0], [0.05, 0.92, 0], [0, 0.05, 0.72]])
    .modulate({ brightness: 0.98, saturation: 1.15 })
    .composite([{ input: glow(w, h, '#fb923c', 0.35), blend: 'screen' }, { input: vignette(w, h, '#431407', 0.35) }]),
  premium: (img, w, h) => img
    .modulate({ saturation: 0.82 })
    .linear(1.08, -8)
    .composite([{ input: vignette(w, h, '#0f172a', 0.45) }]),
  future: (img, w, h) => img
    .recomb([[0.55, 0.2, 0.25], [0.1, 0.85, 0.3], [0.2, 0.3, 1.0]])
    .modulate({ brightness: 0.9, saturation: 1.2 })
    .composite([{ input: glow(w, h, '#22d3ee', 0.3), blend: 'screen' }, { input: vignette(w, h, '#1e1b4b', 0.5) }]),
};

async function build(src, id, category) {
  const input = await fs.readFile(path.join(SRC, src.file));
  const meta = await sharp(input).metadata();
  const widths = WIDTHS.filter((w) => w <= meta.width);
  if (!widths.length || widths.at(-1) < meta.width) { widths.push(meta.width); } // nunca agrandar
  const dir = path.join(OUT, category);
  await fs.mkdir(dir, { recursive: true });
  const variants = {};
  for (const [name, grade] of Object.entries(VARIANTS)) {
    variants[name] = [];
    for (const w of widths) {
      const h = Math.round((meta.height * w) / meta.width);
      const base = sharp(input).resize(w).removeAlpha();
      const graded = await grade(base, w, h).toBuffer(); // composite exige materializar
      const file = `${id}-${name}-${w}.webp`;
      await sharp(graded).webp({ quality: w > 1400 ? 60 : w > 1000 ? 68 : 75, effort: 6 }).toFile(path.join(dir, file));
      variants[name].push({ w, src: `/generated-assets/${category}/${file}` });
    }
  }
  const placeholder = (await sharp(input).resize(24).webp({ quality: 40 }).toBuffer()).toString('base64');
  return { width: meta.width, height: meta.height, variants, placeholder: `data:image/webp;base64,${placeholder}` };
}

const manifest = {};
for (const s of SOURCES) {
  manifest[s.id] = { ...(await build(s, s.id, s.category)), id: s.id, category: s.category, tags: s.tags, title: s.title, alt: s.alt };
  console.log('✓', s.id, `${manifest[s.id].width}px`);
}
for (const h of HOME) {
  const s = SOURCES.find((x) => x.id === h.from);
  manifest[h.id] = { ...(await build(s, h.id, 'home')), id: h.id, category: 'home', tags: [], title: s.title, alt: s.alt };
  console.log('✓ home/', h.id);
}
await fs.mkdir(path.dirname(MANIFEST), { recursive: true });
await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 1));
console.log('Manifiesto:', path.relative(ROOT, MANIFEST));
