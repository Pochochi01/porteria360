import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, LazyMotion, domAnimation } from 'motion/react';
import { Gallery } from '../components/Gallery';
import { Icon } from '../components/icons';
import { srcOf, srcSetOf } from '../lib/assets';
import ASSETS from './data/assets.json';
import { BENEFITS, FEATURES, GALLERY_FILTERS, SLIDES, STATS, TESTIMONIALS, VARIANT_LABEL } from './data/content';
import { Carousel } from './components/Carousel';
import { CardGrid } from './components/CardGrid';
import { DashboardPreview } from './components/DashboardPreview';
import { DemoModal } from './components/DemoModal';
import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { Navbar } from './components/Navbar';
import { Scene } from './components/Scene';
import { Reveal, Section } from './components/Section';
import { Stats } from './components/Stats';
import { Testimonials } from './components/Testimonials';

// Selección curada de la galería: foto × variante generada
const GALLERY = [
  ['country-aereo', 'day'], ['torres', 'day'], ['club-house', 'day'], ['torre-lobby', 'day'], ['country-aereo', 'sunset'],
  ['barrio-lotes', 'day'], ['torres', 'night'], ['club-house', 'premium'], ['country-aereo', 'night'], ['torre-lobby', 'premium'],
  ['barrio-lotes', 'premium'], ['torres', 'future'], ['club-house', 'sunset'], ['country-aereo', 'premium'],
];

const usePageMeta = () =>
  useEffect(() => {
    const prev = document.title;
    document.title = 'AdminCountrys · Gestión de countries, barrios privados y edificios';
    return () => { document.title = prev; };
  }, []);

export default function LandingPage() {
  usePageMeta();
  const [demo, setDemo] = useState(false);
  const openDemo = useCallback(() => setDemo(true), []);
  const closeDemo = useCallback(() => setDemo(false), []);

  // #demo en la URL abre el formulario (links del footer, campañas)
  useEffect(() => {
    const check = () => window.location.hash === '#demo' && setDemo(true);
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);

  const galleryItems = useMemo(() => GALLERY.map(([id, variant]) => {
    const a = ASSETS[id];
    return {
      key: `${id}-${variant}`, title: a.title, caption: VARIANT_LABEL[variant],
      tags: variant === 'premium' || variant === 'night' ? [...new Set([...a.tags, 'premium'])] : a.tags,
      src: srcOf(a, variant, 960), srcSet: srcSetOf(a, variant), width: a.width, height: a.height,
      alt: `${a.alt} (${VARIANT_LABEL[variant].toLowerCase()})`, placeholder: a.placeholder,
    };
  }), []);

  return (
    <LazyMotion features={domAnimation} strict>
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-slate-900">
        Saltar al contenido
      </a>
      <Navbar onDemo={openDemo} />
      <main id="contenido" className="overflow-x-clip">
        <Hero onDemo={openDemo} />

        <Section id="beneficios" eyebrow="Todo en un lugar" title="Una plataforma para cada parte de su comunidad"
          subtitle="Seguridad, administración y vida en comunidad, conectadas. Sin planillas, sin grupos de WhatsApp, sin papeles."
          className="bg-gradient-to-b from-transparent via-sky-50/60 to-transparent dark:via-blue-950/20">
          <CardGrid items={BENEFITS} columns="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3" />
        </Section>

        <Section id="comunidades" eyebrow="Comunidades" title="Pensado para countries, barrios y torres"
          subtitle="Cada complejo con su identidad, sus reglas y su información, aislada del resto.">
          <Carousel slides={SLIDES} />
        </Section>

        <Section id="funcionalidades" eyebrow="Módulos" title="Funcionalidades que su comunidad va a usar todos los días"
          subtitle="Activá solo lo que necesitás. Cada módulo funciona en el celular de residentes, guardias y administración.">
          <CardGrid items={FEATURES} columns="sm:grid-cols-2 lg:grid-cols-4" variant="solid" />
        </Section>

        <section id="panel" className="defer-render relative isolate scroll-mt-20 overflow-hidden px-4 py-20 sm:px-6 sm:py-28" aria-labelledby="panel-title">
          <Scene id="torres" variant="night" fade={false} intensity="strong" />
          <div className="mx-auto max-w-6xl">
            <Reveal blur className="mx-auto mb-12 max-w-2xl text-center">
              <p className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-400">Panel en vivo</p>
              <h2 id="panel-title" className="text-balance font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
                La operación de todo el complejo, en una pantalla
              </h2>
              <p className="text-pretty mt-4 text-lg text-slate-700 dark:text-slate-300">Métricas, accesos, reservas y alertas actualizados en tiempo real. Probá las pestañas.</p>
            </Reveal>
            <Reveal index={1}><DashboardPreview /></Reveal>
          </div>
        </section>

        <Section id="galeria" eyebrow="Galería" title="Espacios que merecen una gestión a la altura"
          subtitle="Cada complejo puede cargar su propia galería, portada y video institucional.">
          <Gallery items={galleryItems} filters={GALLERY_FILTERS} />
        </Section>

        <Section id="testimonios" eyebrow="Clientes" title="Comunidades que ya trabajan distinto">
          <Testimonials items={TESTIMONIALS} />
        </Section>

        <Section id="cifras" eyebrow="En números" title="Una plataforma que crece con cada comunidad"
          className="bg-gradient-to-b from-transparent via-brand-50/70 to-transparent dark:via-brand-950/20">
          <Stats items={STATS} />
        </Section>

        <section className="defer-render px-4 pb-24 sm:px-6" aria-labelledby="cta-title">
          <Reveal className="relative isolate mx-auto max-w-6xl overflow-hidden rounded-[2rem] px-6 py-20 text-center sm:px-12 sm:py-28">
            <Scene id="cta" fade={false} intensity="soft" />
            <div className="absolute inset-0 -z-10 bg-gradient-to-br from-brand-900/70 via-slate-900/60 to-slate-950/80" />
            <h2 id="cta-title" className="text-balance mx-auto max-w-3xl font-display text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
              Transforme la administración de su comunidad
            </h2>
            <p className="text-pretty mx-auto mt-5 max-w-xl text-lg text-white/80">Implementación acompañada, migración de datos incluida y su equipo operativo en días.</p>
            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <button type="button" onClick={openDemo} className="btn h-12 rounded-full bg-white px-7 text-base font-semibold text-slate-900 hover:bg-slate-100">
                Solicitar Demo <Icon name="arrowRight" className="h-4 w-4" />
              </button>
              <a href="/login" className="btn h-12 rounded-full border border-white/30 bg-white/10 px-7 text-base text-white backdrop-blur hover:bg-white/20">Comenzar Ahora</a>
            </div>
          </Reveal>
        </section>
      </main>
      <Footer />
      <AnimatePresence>{demo && <DemoModal onClose={closeDemo} />}</AnimatePresence>
    </LazyMotion>
  );
}
