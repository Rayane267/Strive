import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Suit le réglage système « Réduire les animations » (iOS : Réglages →
 * Accessibilité → Mouvement ; Android : options de développeur / accessibilité).
 *
 * Recommandation Apple : ne pas supprimer la transition, mais remplacer le
 * déplacement par un fondu. Les appelants s'en servent pour retirer ressorts,
 * étirements et translations, en gardant le changement d'état lisible.
 *
 * L'abonnement compte : le réglage peut changer pendant que l'app tourne, et un
 * utilisateur qui vient de l'activer ne doit pas avoir à redémarrer.
 */
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => {
      if (alive) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);

  return reduced;
}

export default useReduceMotion;
