import { useEffect, useRef, useState } from 'react';
import { ASSETS, srcOf, srcSetOf } from '../lib/assets';

/**
 * Imagen responsiva con placeholder borroso y medidas fijas (CLS ≈ 0).
 * @param {{ id: string, variant?: Variant, sizes?: string, className?: string, imgClassName?: string,
 *           priority?: boolean, alt?: string, fill?: boolean }} props
 */
export function ResponsiveImage({ id, variant = 'day', sizes = '100vw', className = '', imgClassName = '', priority = false, alt, fill = false }) {
  const asset = ASSETS[id];
  const imgRef = useRef(null);
  const [loaded, setLoaded] = useState(priority);
  // La imagen pudo terminar de cargar antes de que React hidrate (onLoad no se dispara de nuevo)
  useEffect(() => { if (imgRef.current?.complete) { setLoaded(true); } }, []);
  if (!asset) { return null; }
  return (
    <div
      className={`${fill ? '' : 'relative '}overflow-hidden ${className}`}
      style={{
        ...(fill ? {} : { aspectRatio: `${asset.width} / ${asset.height}` }),
        backgroundImage: loaded ? undefined : `url(${asset.placeholder})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <img
        ref={imgRef}
        src={srcOf(asset, variant, 960)}
        srcSet={srcSetOf(asset, variant)}
        sizes={sizes}
        width={asset.width}
        height={asset.height}
        alt={alt ?? asset.alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding={priority ? 'sync' : 'async'}
        fetchpriority={priority ? 'high' : 'auto'}
        onLoad={() => setLoaded(true)}
        className={`h-full w-full object-cover transition-opacity duration-500 ease-out ${loaded ? 'opacity-100' : 'opacity-0'} ${imgClassName}`}
      />
    </div>
  );
}
