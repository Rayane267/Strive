import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { hapticLight, hapticSuccess, hapticError } from '../utils/haptics';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { restorePurchases } from '../services/iapService';

/**
 * Gestion de l'abonnement, en feuille montant du bas.
 *
 * Structure volontairement différente de la feuille de langue : ici il n'y a pas
 * de choix à faire, mais un état à annoncer puis une action à proposer. D'où une
 * carte de message et une carte d'action, et non une liste d'options.
 *
 * Remplace `Alert.alert` pour le résultat de la restauration : une alerte
 * système impose son style et ses boutons, et surtout elle chassait la feuille
 * au lieu de s'y inscrire.
 */

const DURATION = 260;

type Result = 'idle' | 'restoring' | 'found' | 'none' | 'error';

const ManageSubscriptionSheet = ({
  visible,
  onClose,
  isSubscribed,
  planLabel,
  userId,
  onRestored,
}: {
  visible: boolean;
  onClose: () => void;
  isSubscribed: boolean;
  planLabel: string;
  userId?: string;
  onRestored: () => void;
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;
  const [result, setResult] = useState<Result>('idle');

  // L'état repart à zéro à chaque ouverture : rouvrir la feuille après un échec
  // ne doit pas rejouer le message de la fois précédente.
  useEffect(() => { if (visible) setResult('idle'); }, [visible]);

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : DURATION,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [visible, anim, reduceMotion]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [460, 0] });

  const handleRestore = async () => {
    if (result === 'restoring') return;
    hapticLight();
    setResult('restoring');
    try {
      const found = await restorePurchases(userId);
      if (found) {
        hapticSuccess();
        setResult('found');
        onRestored();
      } else {
        setResult('none');
      }
    } catch {
      hapticError();
      setResult('error');
    }
  };

  const openStore = () => {
    hapticLight();
    Linking.openURL(
      Platform.OS === 'ios'
        ? 'https://apps.apple.com/account/subscriptions'
        : 'https://play.google.com/store/account/subscriptions',
    );
  };

  // Le titre suit l'état réel plutôt que l'intitulé du menu : un abonné qui
  // vient de restaurer doit lire autre chose qu'au moment où il a ouvert.
  const { title, subtitle } =
    result === 'found'
      ? {
          title: t('subscription.restoreSuccess', 'Achats restaurés !'),
          subtitle: t('subscription.restoreSuccessSub', 'Votre abonnement est de nouveau actif.'),
        }
      : result === 'error'
      ? {
          title: t('subscription.restoreFail', 'Impossible de restaurer les achats.'),
          subtitle: t('subscription.restoreFailSub', 'Vérifiez votre connexion et réessayez.'),
        }
      : result === 'none' || !isSubscribed
      ? {
          title: t('subscription.noneFound', 'Aucun abonnement trouvé'),
          subtitle: t('subscription.noneFoundSub', 'Nous pouvons vérifier vos achats précédents'),
        }
      : {
          title: t('subscription.activeTitle', 'Abonnement actif'),
          subtitle: t('subscription.activeSub', 'Formule {{plan}}', { plan: planLabel }),
        };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: anim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[styles.sheet, { paddingBottom: insets.bottom + 20, transform: [{ translateY }] }]}
        >
          <View style={styles.closeRow}>
            <Pressable
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close', 'Fermer')}
            >
              <Feather name="x" size={22} color={colors.textMain} />
            </Pressable>
          </View>

          <View style={styles.messageCard}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>

          {isSubscribed && result !== 'found' ? (
            <Pressable
              onPress={openStore}
              style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.actionText}>
                {t('subscription.manageStore', Platform.OS === 'ios'
                  ? "Gérer sur l'App Store"
                  : 'Gérer sur Google Play')}
              </Text>
            </Pressable>
          ) : null}

          {/* La restauration disparaît une fois qu'elle a abouti : la reproposer
              laisserait croire qu'elle a échoué. */}
          {result !== 'found' ? (
            <Pressable
              onPress={handleRestore}
              disabled={result === 'restoring'}
              style={({ pressed }) => [styles.actionCard, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              {result === 'restoring' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Text style={styles.actionText}>
                  {t('subscription.restorePrevious', 'Restaurer les achats précédents')}
                </Text>
              )}
            </Pressable>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.6)' },

  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 14,
    gap: 14,
  },

  // La croix est posée seule au-dessus des cartes, comme dans la référence : la
  // feuille n'a pas d'en-tête, ce sont les cartes qui portent le contenu.
  closeRow: { alignItems: 'flex-end' },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
  },

  messageCard: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 20,
    paddingVertical: 22,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  title: {
    color: colors.textMain,
    fontSize: 19,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 6,
  },

  // Cible de 60 px : ces cartes se tapent d'une main, souvent en déplacement.
  actionCard: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 20,
    minHeight: 60,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  actionText: { color: colors.textMain, fontSize: 17, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});

export default ManageSubscriptionSheet;
