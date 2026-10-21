import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMarketT } from '../hooks/useMarketT';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { hapticLight } from '../utils/haptics';
import type { LatLng } from '../utils/zones';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { elevation } from '../theme/elevation';
import GlassFill from './GlassFill';

/** Glissé au-delà, ou lancé assez vite vers le bas : la feuille se ferme. */
const CLOSE_DISTANCE = 90;
const CLOSE_VELOCITY = 0.9;
/** Position fermée : assez bas pour sortir de l'écran quelle que soit la hauteur. */
const HIDDEN = 640;

/**
 * Feuille de la carte, tirable vers le bas — le geste des applications de VTC
 * que les chauffeurs ont déjà dans les doigts. Dans une Modal : elle passe
 * devant la barre d'onglets au lieu de glisser dessous.
 *
 * `target` ouvre la feuille et sert de destination au bouton de navigation ;
 * le contenu, lui, vient de l'écran.
 */
const MapSheet = ({
  target,
  onClose,
  children,
}: {
  target: LatLng | null;
  onClose: () => void;
  children: React.ReactNode;
}) => {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const y = useRef(new Animated.Value(HIDDEN)).current;
  // La feuille reste montée le temps de sa sortie : sans ça, elle disparaîtrait
  // d'un coup au lieu de glisser. Son contenu aussi, pour la même raison.
  const [shown, setShown] = useState<LatLng | null>(target);
  const content = useRef<React.ReactNode>(children);
  if (target) content.current = children;

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (target) {
      setShown(target);
      if (reduceMotion) {
        y.setValue(0);
        return;
      }
      y.setValue(HIDDEN);
      Animated.spring(y, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 230,
        mass: 0.9,
      }).start();
    } else if (shown) {
      Animated.timing(y, {
        toValue: HIDDEN,
        duration: reduceMotion ? 0 : 220,
        useNativeDriver: true,
      }).start(() => setShown(null));
    }
    // `shown` volontairement absent : seule l'arrivée d'une nouvelle cible
    // déclenche une animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, y, reduceMotion]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        // Vers le haut, la feuille résiste au lieu de suivre : elle n'a rien
        // de plus à montrer.
        y.setValue(g.dy > 0 ? g.dy : g.dy / 6);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > CLOSE_DISTANCE || g.vy > CLOSE_VELOCITY) {
          hapticLight();
          onCloseRef.current();
        } else {
          Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 260 }).start();
        }
      },
    }),
  ).current;

  const backdropOpacity = y.interpolate({
    inputRange: [0, HIDDEN],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <Modal navigationBarTranslucent visible={!!shown} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          { paddingBottom: insets.bottom + space.xl, transform: [{ translateY: y }] },
        ]}
        {...pan.panHandlers}
      >
        <GlassFill corners={styles.sheetCorners} />
        <View style={styles.handle} />
        {content.current}
      </Animated.View>
    </Modal>
  );
};

/** Bouton « Lancer la navigation » : ouvre Plans vers la zone sur iOS, Google
 *  Maps sur Android (l'appli, ou le navigateur à défaut). */
export const SheetNavButton = ({ to }: { to: LatLng }) => {
  const { t } = useMarketT();
  return (
    <TouchableOpacity
      style={styles.navButton}
      onPress={() => {
        hapticLight();
        const url =
          Platform.OS === 'ios'
            ? `maps://?daddr=${to.latitude},${to.longitude}&dirflg=d`
            : `https://www.google.com/maps/dir/?api=1&destination=${to.latitude},${to.longitude}&travelmode=driving`;
        Linking.openURL(url).catch(() => {});
      }}
      accessibilityRole="button"
    >
      <Feather name="navigation" size={18} color={NAV_INK} />
      <Text style={styles.navText}>{t('zones.sheetNavigate')}</Text>
    </TouchableOpacity>
  );
};

const NAV_INK = '#111214';

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.25)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    ...elevation.floating.shadow,
  },
  sheetCorners: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginBottom: space.lg,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.xl,
    paddingVertical: space.lg,
    borderRadius: radius.md,
    // Bouton clair, comme la fiche Uber : la seule action de la fiche.
    backgroundColor: '#E9E9EB',
  },
  navText: { color: NAV_INK, fontSize: 17, fontWeight: '600' },
});

export default MapSheet;
