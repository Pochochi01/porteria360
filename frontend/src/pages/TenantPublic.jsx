import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LazyMotion, domAnimation } from 'motion/react';
import { api, errMsg } from '../lib/api';
import { brandStyle } from '../theme/brand';
import { Gallery } from '../components/Gallery';
import { Icon } from '../components/icons';
import { ThemeToggle } from '../components/ThemeToggle';
import { ResponsiveImage } from '../components/ResponsiveImage';

const CATEGORY_LABEL = { countries: 'Countries', edificios: 'Edificios', barrios: 'Barrios', premium: 'Premium', amenities: 'Amenities' };

/** YouTube / Vimeo → URL de embed (cualquier otra URL se muestra como link). */
function embedUrl(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)youtube\.com$/.test(u.hostname) && u.searchParams.get('v')) { return `https://www.youtube-nocookie.com/embed/${u.searchParams.get('v')}`; }
    if (u.hostname === 'youtu.be') { return `https://www.youtube-nocookie.com/embed${u.pathname}`; }
    if (/(^|\.)vimeo\.com$/.test(u.hostname) && /^\/\d+/.test(u.pathname)) { return `https://player.vimeo.com/video${u.pathname}`; }
  } catch { /* URL inválida */ }
  return null;
}

/** Página pública de un complejo: portada, logo, colores, tipografía, video y galería administrables. */
export default function TenantPublic() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/public/tenants/${encodeURIComponent(slug)}`).then((r) => setData(r.data)).catch((e) => setError(errMsg(e)));
  }, [slug]);
  useEffect(() => {
    if (data) { document.title = `${data.settings.display_name} · AdminCountrys`; }
  }, [data]);

  const items = useMemo(() => (data?.gallery || []).map((g) => ({
    key: String(g.id), title: g.title || data.settings.display_name, caption: CATEGORY_LABEL[g.category],
    tags: [g.category], src: g.url, width: g.width, height: g.height, alt: g.title || `Foto de ${data.settings.display_name}`,
  })), [data]);
  const filters = useMemo(() => {
    const used = [...new Set(items.flatMap((i) => i.tags))];
    return used.length > 1 ? [{ id: 'all', label: 'Todas' }, ...used.map((c) => ({ id: c, label: CATEGORY_LABEL[c] }))] : null;
  }, [items]);

  if (error) {
    return (
      <main className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <p className="font-display text-2xl font-bold text-slate-900 dark:text-white">Página no disponible</p>
          <p className="mt-2 text-slate-600 dark:text-slate-400">{error}</p>
          <Link to="/" className="btn-primary mt-6">Ir al inicio</Link>
        </div>
      </main>
    );
  }
  if (!data) { return <div className="grid min-h-screen place-items-center"><span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /></div>; }

  const s = data.settings;
  const embed = s.video_external && embedUrl(s.video_external);
  return (
    <LazyMotion features={domAnimation} strict>
      <div style={brandStyle(s)} className="min-h-screen">
        <header className="relative isolate overflow-hidden">
          <div className="absolute inset-0 -z-10">
            {s.cover_url
              ? <img src={s.cover_url} alt="" className="h-full w-full object-cover" fetchpriority="high" />
              : <ResponsiveImage id="hero" fill priority className="absolute inset-0 h-full w-full" alt="" />}
            <div className="absolute inset-0 bg-gradient-to-b from-brand-950/40 via-brand-950/50 to-slate-50 transition-colors duration-700 dark:from-slate-950/60 dark:via-slate-950/70 dark:to-slate-950" />
          </div>
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6" aria-label="Complejo">
            <span className="flex items-center gap-3 font-display text-lg font-bold text-white">
              {s.logo_url && <img src={s.logo_url} alt={`Logo de ${s.display_name}`} className="h-10 w-10 rounded-xl bg-white object-contain p-1 shadow" />}
              {s.display_name}
            </span>
            <span className="flex items-center gap-2">
              <ThemeToggle className="border-white/30 bg-white/15 text-white hover:bg-white/25" />
              <Link to={`/login?tenant=${encodeURIComponent(data.tenant.slug)}`} className="btn rounded-full bg-white px-5 text-slate-900 hover:bg-slate-100">Ingresar</Link>
            </span>
          </nav>
          <div className="mx-auto max-w-6xl px-4 pb-28 pt-16 sm:px-6 sm:pb-36 sm:pt-24">
            <h1 className="text-balance max-w-3xl font-display text-4xl font-extrabold tracking-tight text-white sm:text-6xl">{s.display_name}</h1>
            {s.tagline && <p className="text-pretty mt-4 max-w-2xl text-lg text-white/85 sm:text-xl">{s.tagline}</p>}
          </div>
        </header>

        <main className="mx-auto max-w-6xl space-y-20 px-4 pb-24 sm:px-6">
          {(s.description || s.video_url) && (
            <section className="grid items-center gap-10 lg:grid-cols-2" aria-label="Sobre el complejo">
              {s.description && <p className="text-pretty whitespace-pre-line text-lg leading-relaxed text-slate-700 dark:text-slate-300">{s.description}</p>}
              {s.video_url && (
                <div className="overflow-hidden rounded-3xl bg-black shadow-xl">
                  {embed ? (
                    <iframe src={embed} title={`Video institucional de ${s.display_name}`} className="aspect-video w-full" loading="lazy"
                      allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" />
                  ) : s.video_external ? (
                    <a href={s.video_external} target="_blank" rel="noopener noreferrer" className="flex aspect-video items-center justify-center gap-2 text-white">
                      <Icon name="play" /> Ver video institucional
                    </a>
                  ) : (
                    <video src={s.video_url} controls preload="metadata" playsInline className="aspect-video w-full" poster={s.cover_url || undefined}>
                      Tu navegador no puede reproducir este video.
                    </video>
                  )}
                </div>
              )}
            </section>
          )}
          {items.length > 0 && (
            <section aria-labelledby="galeria-title">
              <h2 id="galeria-title" className="mb-8 font-display text-3xl font-bold text-slate-900 dark:text-white">Galería</h2>
              <Gallery items={items} filters={filters} />
            </section>
          )}
        </main>
        <footer className="border-t border-slate-200 py-8 text-center text-sm text-slate-500 dark:border-white/10">
          {s.display_name} · Gestionado con <Link to="/" className="font-medium text-brand-700 hover:underline dark:text-brand-400">AdminCountrys</Link>
        </footer>
      </div>
    </LazyMotion>
  );
}
