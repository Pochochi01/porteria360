import ASSETS from '../landing/data/assets.json';

export { ASSETS };

/** @typedef {'day' | 'night' | 'sunset' | 'premium' | 'future'} Variant */

/** srcset de una variante generada por scripts/generate-assets.mjs */
export const srcSetOf = (asset, variant = 'day') =>
  asset.variants[variant].map((v) => `${v.src} ${v.w}w`).join(', ');

/** URL más cercana a un ancho dado (para preload / og:image). */
export const srcOf = (asset, variant = 'day', width = 1440) =>
  (asset.variants[variant].find((v) => v.w >= width) || asset.variants[variant].at(-1)).src;

