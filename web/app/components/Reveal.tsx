'use client';

import { useEffect, useRef, useState } from 'react';

export default function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // `.reveal` part à `opacity: 0` : tout chemin où l'observer ne se déclenche
    // pas laisse un bloc invisible pour toujours. Les webviews anciennes (et
    // celles des apps qui ouvrent le lien depuis un feed) n'ont pas toujours
    // IntersectionObserver — dans ce cas on affiche, sans animation.
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    // threshold: 0 plutôt que 0.15. Le ratio se calcule sur la TAILLE DU BLOC,
    // pas sur celle de l'écran : une section plus haute que ~6,5 écrans ne
    // peut jamais atteindre 15 % de visibilité et ne se révélait donc jamais —
    // le cas d'un empilement de cartes sur un téléphone. La marge négative
    // rend l'effet au même moment qu'avant, sans ce plafond.
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0, rootMargin: '0px 0px -8% 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? 'visible' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
