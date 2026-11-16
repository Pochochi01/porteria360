import { useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { useFinePointer } from '../hooks/useMediaQuery';

/**
 * Tarjeta con inclinación 3D y brillo que sigue al mouse.
 * Escribe el transform directo en el elemento (sin re-render ni variables heredadas → 60 FPS).
 * Solo se activa con mouse/trackpad y sin "reducir movimiento".
 * @param {{ as?: any, max?: number, className?: string, children: any, glare?: boolean } & Record<string, any>} props
 */
export function TiltCard({ as: Tag = 'div', max = 8, className = '', glare = true, children, ...rest }) {
  const ref = useRef(null);
  const glareRef = useRef(null);
  const fine = useFinePointer();
  const reduce = useReducedMotion();
  const enabled = fine && !reduce;

  const onMove = (e) => {
    const el = ref.current;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transition = 'transform 120ms ease-out';
    el.style.transform = `perspective(900px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg) translate3d(0,-4px,0)`;
    if (glareRef.current) {
      glareRef.current.style.opacity = '1';
      glareRef.current.style.transform = `translate3d(${(px * 100).toFixed(0)}%, ${(py * 100).toFixed(0)}%, 0)`;
    }
  };
  const onLeave = () => {
    const el = ref.current;
    el.style.transition = 'transform 600ms cubic-bezier(0.23, 1, 0.32, 1)';
    el.style.transform = '';
    if (glareRef.current) { glareRef.current.style.opacity = '0'; }
  };

  return (
    <Tag ref={ref} onPointerMove={enabled ? onMove : undefined} onPointerLeave={enabled ? onLeave : undefined}
      className={`relative will-change-transform ${className}`} {...rest}>
      {children}
      {enabled && glare && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
          <span ref={glareRef}
            className="absolute -inset-1/2 bg-[radial-gradient(circle_at_center,rgb(255_255_255/0.35),transparent_40%)] opacity-0 transition-opacity duration-300 dark:bg-[radial-gradient(circle_at_center,rgb(255_255_255/0.12),transparent_40%)]" />
        </span>
      )}
    </Tag>
  );
}
