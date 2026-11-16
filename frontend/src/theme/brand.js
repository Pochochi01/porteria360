// Branding por complejo: genera la escala brand-50…950 a partir de un color y la publica como variables CSS.

export const FONTS = ['Inter', 'Manrope', 'Plus Jakarta Sans', 'DM Sans', 'Outfit', 'Sora', 'Playfair Display', 'Fraunces'];

const hexToRgb = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// El color elegido es el tono 700 (el de los botones principales)
const STEPS = { 50: ['w', 0.94], 100: ['w', 0.86], 200: ['w', 0.72], 300: ['w', 0.55], 400: ['w', 0.35], 500: ['w', 0.18],
  600: ['w', 0.08], 700: ['b', 0], 800: ['b', 0.18], 900: ['b', 0.32], 950: ['b', 0.55] };

/**
 * @param {string} hex color #RRGGBB
 * @returns {Record<string, string>} variables CSS (canales "r g b")
 */
function brandVars(hex, accentHex) {
  const base = hexToRgb(hex);
  const vars = {};
  for (const [step, [to, t]] of Object.entries(STEPS)) { vars[`--brand-${step}`] = mix(base, to === 'w' ? [255, 255, 255] : [0, 0, 0], t).join(' '); }
  // Texto sobre el botón principal: blanco o casi negro, el que cumpla mejor WCAG AA
  vars['--brand-on'] = contrast(base, [255, 255, 255]) >= contrast(base, [15, 23, 42]) ? '255 255 255' : '15 23 42';
  if (accentHex) { vars['--accent'] = hexToRgb(accentHex).join(' '); }
  return vars;
}

/** Carga una fuente de Google Fonts una sola vez (display=swap, sin bloquear el render). */
function loadFont(family) {
  if (!family || !FONTS.includes(family) || family === 'Inter') { return; }
  const id = `gf-${family.replace(/\s+/g, '-')}`;
  if (document.getElementById(id)) { return; }
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;600;700;800&display=swap`;
  document.head.appendChild(link);
}

/** Estilo inline con el branding, para previsualizar o aislar una sección. */
export function brandStyle(b) {
  if (!b?.primary_color) { return undefined; }
  [b.font_display, b.font_body].forEach(loadFont);
  return {
    ...brandVars(b.primary_color, b.accent_color),
    ...(b.font_display && { '--font-display': `'${b.font_display}'` }),
    ...(b.font_body && { '--font-body': `'${b.font_body}'` }),
  };
}
