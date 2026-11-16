import { useEffect, useState } from 'react';

/** Posición del elemento; si no tiene layout (rect 0×0: está dentro de una sección con
 *  content-visibility:auto fuera de pantalla) se usa la sección, que conserva su alto reservado. */
function rectOf(el) {
  const r = el.getBoundingClientRect();
  return r.width || r.height ? r : (el.closest('.defer-render') ?? el).getBoundingClientRect();
}
/** En pantalla (con el mismo margen inferior que el observer) o ya pasado de largo. */
const shouldReveal = (el) => rectOf(el).top < window.innerHeight * 0.88;

// Elementos esperando revelarse → función que los revela
const pending = new Map();
function reveal(el) {
  pending.get(el)?.();
  pending.delete(el);
  observer?.unobserve(el);
}

// Camino principal: un solo IntersectionObserver compartido
let observer;
function getObserver() {
  observer ??= new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting || rectOf(e.target).bottom < 0) { reveal(e.target); }
    }),
    { rootMargin: '0px 0px -12% 0px', threshold: 0.12 }
  );
  return observer;
}

// Red de seguridad: Chrome a veces no avisa al observer cuando una sección con content-visibility:auto
// pasa de omitida a renderizada durante un scroll rápido. Al terminar cada scroll se revisan los pendientes.
let scrollTimer;
function checkPending() {
  for (const el of pending.keys()) {
    if (shouldReveal(el)) { reveal(el); }
  }
}
function onScroll() {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(checkPending, 150);
}
function track(el, cb) {
  if (!pending.size) { window.addEventListener('scroll', onScroll, { passive: true }); }
  pending.set(el, cb);
  getObserver().observe(el);
}
function untrack(el) {
  pending.delete(el);
  observer?.unobserve(el);
  if (!pending.size) { window.removeEventListener('scroll', onScroll); }
}

/**
 * Devuelve true una sola vez, cuando el elemento entra en el viewport
 * (o si ya quedó atrás: el usuario scrolleó antes de que la página terminara de hidratarse).
 * Usa un callback ref: el efecto corre cuando el elemento existe de verdad.
 * @returns {[(el: HTMLElement | null) => void, boolean]}
 */
export function useInViewOnce() {
  const [el, setEl] = useState(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!el || inView) { return; }
    // Sin IntersectionObserver, o si ya se pasó de largo: el observer no avisaría nunca
    if (!('IntersectionObserver' in window) || rectOf(el).bottom < 0) {
      setInView(true);
      return;
    }
    track(el, () => setInView(true));
    return () => untrack(el);
  }, [el, inView]);
  return [setEl, inView];
}

/**
 * Props para revelar un elemento al hacer scroll (CSS .reveal en index.css).
 * @param {{ index?: number, blur?: boolean }} [opts] index: orden en un stagger
 */
export function useReveal({ index = 0, blur = false } = {}) {
  const [ref, inView] = useInViewOnce();
  return {
    ref,
    className: `reveal${blur ? ' reveal-blur' : ''}${inView ? ' is-in' : ''}`,
    style: { '--i': index },
  };
}
