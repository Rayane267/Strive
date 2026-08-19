import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { hapticSuccess, hapticError } from '../utils/haptics';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { restorePurchases } from '../services/iapService';

/**
 * Résultat d'une restauration d'achats, en feuille montant du bas.
 *
 * Distincte de `ManageSubscriptionSheet` : celle-ci n'offre aucun choix et ne
 * mène nulle part — elle annonce un résultat et se referme. D'où une seule
 * action, pleine largeur, et un texte qui porte toute l'information.
 *
 * La restauration part dès l'ouverture : l'utilisateur a déjà exprimé son
 * intention en tapant la ligne, lui redemander de confirmer ajouterait un tap
 * pour rien.
 */

const DURATION = 260;

type State = 'restoring' | 'found' | 'none' | 'error';

const RestorePurchasesSheet = ({
  visible,
  onClose,
  userId,
  onRestored,
}: {
  visible: boolean;
  onClose: () => void;
  userId?: string;
  onRestored: () => void;
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;
  const [state, setState] = useState<State>('restoring');

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setState('restoring');
    (async () => {
      try {
        const found = await restorePurchases(userId);
        if (cancelled) return;
        if (found) { hapticSuccess(); setState('found'); onRestored(); }
        else setState('none');
      } catch {
        if (cancelled) return;
        hapticError();
        setState('error');
      }
    })();
    // La feuille peut être fermée pendant l'appel : sans ce garde, la réponse
    // arriverait sur un composant déjà masqué et rallumerait son contenu.
    return () => { cancelled = true; };
  }, [visible, userId, onRestored]);

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : DURATION,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [visible, anim, reduceMotion]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [420, 0] });

  const message =
    state === 'restoring' ? t('subscription.restoreChecking', 'Vérification de vos achats…')
    : state === 'found' ? t('subscription.restoreSuccessSub', 'Votre abonnement est de nouveau actif.')
    : state === 'error' ? t('subscription.restoreFailSub', 'Vérifiez votre connexion et réessayez.')
    : t('subscription.restoreNoneSub', "Aucun abonnement actif n'a été trouvé sur ce compte.");

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: anim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[styles.sheet, { paddingBottom: insets.bottom + 20, transform: [{ translateY }] }]}
        >
          <View style={styles.handle} />

          <View style={styles.headRow}>
            <View style={styles.iconBadge}>
              <Feather
                name={state === 'error' ? 'alert-circle' : state === 'found' ? 'check-circle' : 'info'}
                size={20}
                color={state === 'error' ? colors.danger : colors.primary}
              />
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close', 'Fermer')}
            >
              <Feather name="x" size={24} color={colors.textMain} />
            </Pressable>
          </View>

          <Text style={styles.title}>{t('subscription.restore', 'Restaurer les achats')}</Text>
          <Text style={styles.message}>{message}</Text>

          {/* Le bouton reste affiché pendant la vérification, mais inactif : le
              faire apparaître après coup déplacerait le contenu sous le doigt. */}
          <Pressable
            onPress={onClose}
            disabled={state === 'restoring'}
            style={({ pressed }) => [
              styles.okBtn,
              state === 'restoring' && styles.okBtnDisabled,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="OK"
          >
            {state === 'restoring'
              ? <ActivityIndicator size="small" color={colors.textMuted} />
              : <Text style={styles.okText}>OK</Text>}
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.6)' },

  sheet: {
    backgroundColor: colors.surfaceLight,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 18,
  },

  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  iconBadge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  title: { color: colors.textMain, fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
  message: { color: colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: 6 },

  okBtn: {
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 26,
  },
  okBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.08)' },
  okText: { color: colors.background, fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
  pressed: { opacity: 0.8 },
});

export default RestorePurchasesSheet;
