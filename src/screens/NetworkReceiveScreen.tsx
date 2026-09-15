import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Feather from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import ScreenField from '../components/ScreenField';
import AnimatedEntrance from '../components/AnimatedEntrance';
import NetworkDirectionSwitch from '../components/NetworkDirectionSwitch';
import SplitBar from '../components/SplitBar';
import AvatarView from '../components/AvatarView';
import { colors } from '../theme/colors';
import { useMarket } from '../hooks/useMarket';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { stroke, strokeWidth } from '../theme/stroke';
import { elevation } from '../theme/elevation';
import { FIELD_TOP } from '../theme/field';
import { hapticSuccess } from '../utils/haptics';
import {
  DEMO_OFFERS,
  DEMO_WEEK,
  NetworkOffer,
  money,
  moneyParts,
  referrerName,
  splitFare,
} from '../services/networkDemo';

const HOWTO_SEEN_KEY = '@strive_network_howto';

/**
 * Recevoir — le sens entrant du réseau.
 *
 * Une règle tient tout l'écran : **le gros chiffre d'une carte est ce que le
 * chauffeur touche**, jamais le prix convenu. 45,76 € et pas 52 €. Afficher le
 * brut en gros et la commission en petit est la manière habituelle de dire la
 * vérité sans être compris ; ici le prix convenu existe, mais en ligne de
 * détail, sous le net.
 *
 * Le bloc « Comment ça marche » ne s'explique qu'une fois : le mécanisme est
 * nouveau, donc il se raconte, mais un chauffeur qui ouvre ce flux dix fois par
 * jour n'a pas à le relire dix fois. Refermé, il laisse une ligne pour le
 * rouvrir.
 */
const NetworkReceiveScreen = () => {
  const market = useMarket();
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();

  const [howtoOpen, setHowtoOpen] = useState(false);
  const [howtoChecked, setHowtoChecked] = useState(false);
  const [accepted, setAccepted] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(HOWTO_SEEN_KEY)
      .then(v => setHowtoOpen(v !== '1'))
      .catch(() => setHowtoOpen(true))
      .finally(() => setHowtoChecked(true));
  }, []);

  const m = (v: number) => money(v, i18n.language);

  const closeHowto = () => {
    setHowtoOpen(false);
    AsyncStorage.setItem(HOWTO_SEEN_KEY, '1').catch(() => {});
  };

  const accept = (id: string) => {
    hapticSuccess();
    setAccepted(prev => [...prev, id]);
  };

  const weekTotal = DEMO_WEEK.taken + DEMO_WEEK.referral;

  const renderOffer = (offer: NetworkOffer, index: number) => {
    const split = splitFare(offer.fare);
    const isAccepted = accepted.includes(offer.id);
    const net = moneyParts(split.driver, i18n.language);

    return (
      <AnimatedEntrance key={offer.id} delay={200 + index * 80} slideDistance={26}>
        <View style={[styles.offerCard, isAccepted && styles.offerCardDone]}>
          <View style={styles.offerTop}>
            <View style={styles.distPill}>
              <Feather name="navigation" size={12} color={colors.primary} />
              <Text style={styles.distText}>
                {t('rideNetwork.receive.toPickup', {
                  km: offer.toPickupKm.toFixed(1).replace('.', i18n.language === 'fr' ? ',' : '.'),
                  min: offer.toPickupMin,
                })}
              </Text>
            </View>
            <Text style={styles.postedText}>
              {t('rideNetwork.receive.posted', { min: offer.postedMinAgo })}
            </Text>
          </View>

          <View style={styles.routeStrip}>
            <View style={styles.rail}>
              <View style={styles.railDot} />
              <View style={styles.railLine} />
              <View style={styles.railEnd} />
            </View>
            <View style={styles.routeTexts}>
              <Text style={styles.routeText} numberOfLines={1}>{offer.pickup}</Text>
              <Text style={[styles.routeText, styles.routeDest]} numberOfLines={1}>
                {offer.dropoff}
              </Text>
            </View>
          </View>

          <View style={styles.netBlock}>
            <View style={styles.netLeft}>
              <Text style={styles.netLabel}>{t('rideNetwork.receive.net')}</Text>
              {/* Le chiffre héros : l'entier porte, les décimales reculent. */}
              <Text style={styles.netValue}>
                {net.int}
                <Text style={styles.netDecimals}>{net.sep}{net.dec} {market.symbol}</Text>
              </Text>
            </View>
            <View style={styles.tripMeta}>
              <Text style={styles.tripMetaText}>{offer.tripKm} km</Text>
              <Text style={styles.tripMetaText}>{offer.tripMin} min</Text>
            </View>
          </View>

          {/* Le prix convenu ne disparaît pas — il passe en ligne de détail.
              C'est ce qui permet de vérifier le net plutôt que de le croire. */}
          <Text style={styles.grossNote}>
            {t('rideNetwork.receive.grossNote', {
              gross: m(split.fare),
              referrer: m(split.referrer),
              platform: m(split.platform),
            })}
          </Text>

          <View style={styles.referrerRow}>
            <AvatarView
              avatarId={offer.referrer.avatarId}
              size={34}
              borderColor="rgba(255,255,255,0.12)"
            />
            <View style={styles.referrerText}>
              <View style={styles.referrerNameRow}>
                <Text style={styles.referrerName} numberOfLines={1}>
                  {referrerName(offer.referrer)}
                </Text>
                {offer.referrer.verified && (
                  <View style={styles.verifiedPill}>
                    <Feather name="check" size={10} color={colors.primary} />
                    <Text style={styles.verifiedText}>
                      {t('rideNetwork.receive.verified')}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.referrerMeta} numberOfLines={1}>
                {t('rideNetwork.receive.broughtBy')} ·{' '}
                {t('rideNetwork.receive.ridesShared', {
                  count: offer.referrer.ridesShared,
                })}
              </Text>
            </View>
          </View>

          {isAccepted ? (
            <View style={styles.acceptedStrip}>
              <Feather name="check-circle" size={16} color={colors.primary} />
              <Text style={styles.acceptedText}>
                {t('rideNetwork.receive.acceptedNote')}
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.acceptBtn}
              onPress={() => accept(offer.id)}
              activeOpacity={0.85}
              accessibilityRole="button"
            >
              <Text style={styles.acceptText}>
                {t('rideNetwork.receive.accept', { amount: m(split.driver) })}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </AnimatedEntrance>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenField />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Feather name="chevron-left" size={30} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('rideNetwork.title')}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.switchWrap}>
        <NetworkDirectionSwitch
          active="receive"
          onSwitch={() => navigation.replace('NetworkOffer')}
        />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* ── COMMENT ÇA MARCHE ── */}
        {howtoChecked && (
          <AnimatedEntrance step={0}>
            {howtoOpen ? (
              <View style={styles.howCard}>
                <Text style={styles.howTitle}>{t('rideNetwork.receive.howTitle')}</Text>
                {[1, 2, 3].map(n => (
                  <View key={n} style={styles.howStep}>
                    <View style={styles.howNum}>
                      <Text style={styles.howNumText}>{n}</Text>
                    </View>
                    <Text style={styles.howText}>
                      {t(`rideNetwork.receive.how${n}`)}
                    </Text>
                  </View>
                ))}
                <TouchableOpacity
                  style={styles.howBtn}
                  onPress={closeHowto}
                  activeOpacity={0.8}
                >
                  <Text style={styles.howBtnText}>
                    {t('rideNetwork.receive.howGot')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.howLink}
                onPress={() => setHowtoOpen(true)}
                activeOpacity={0.7}
              >
                <Feather name="help-circle" size={15} color={colors.textDimmed} />
                <Text style={styles.howLinkText}>
                  {t('rideNetwork.receive.howTitle')}
                </Text>
              </TouchableOpacity>
            )}
          </AnimatedEntrance>
        )}

        {/* ── COURSES À PROXIMITÉ ── */}
        <AnimatedEntrance step={1}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('rideNetwork.receive.nearby')}</Text>
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>
                {t('rideNetwork.receive.nearbyCount', { count: DEMO_OFFERS.length })}
              </Text>
            </View>
          </View>
        </AnimatedEntrance>

        {DEMO_OFFERS.map(renderOffer)}

        {/* ── GAINS RÉSEAU DE LA SEMAINE ── */}
        <AnimatedEntrance delay={200 + DEMO_OFFERS.length * 80} focal>
          <View style={styles.weekCard}>
            <Text style={styles.cardLabel}>{t('rideNetwork.receive.weekTitle')}</Text>
            <Text style={styles.weekTotal}>{m(weekTotal)}</Text>

            {/* Les deux sens comptés séparément. Un total réseau unique cacherait
                exactement ce que cet écran doit rendre visible : ce que rapporte
                le fait d'apporter, à côté de ce que rapporte le fait de rouler. */}
            <View style={styles.weekBar}>
              <SplitBar
                segments={[
                  {
                    key: 'taken',
                    ratio: DEMO_WEEK.taken / weekTotal,
                    color: colors.primary,
                    label: t('rideNetwork.receive.weekTaken'),
                    amount: m(DEMO_WEEK.taken),
                    mine: true,
                  },
                  {
                    key: 'referral',
                    ratio: DEMO_WEEK.referral / weekTotal,
                    color: 'rgba(255,255,255,0.28)',
                    label: t('rideNetwork.receive.weekReferral'),
                    amount: m(DEMO_WEEK.referral),
                  },
                ]}
              />
            </View>

            <Text style={styles.weekMeta}>
              {t('rideNetwork.receive.weekMeta', {
                taken: DEMO_WEEK.ridesTaken,
                referred: DEMO_WEEK.ridesReferred,
              })}
            </Text>
          </View>
        </AnimatedEntrance>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FIELD_TOP },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  backBtn: {
    marginLeft: -10,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    marginRight: space.md,
    color: colors.textMain,
    fontSize: 26,
    fontWeight: '800',
  },
  headerSpacer: { width: 38 },
  switchWrap: { paddingHorizontal: space.xl, paddingBottom: space.md },
  content: { paddingHorizontal: space.xl, paddingBottom: space.xxxl },

  // Comment ça marche
  howCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.lg,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    marginBottom: space.xl,
  },
  howTitle: {
    color: colors.textMain,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: space.md,
  },
  howStep: { flexDirection: 'row', gap: space.md, marginBottom: space.md },
  howNum: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,230,118,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  howNumText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  howText: { flex: 1, color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  howBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.lg,
    height: 38,
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    marginTop: space.xs,
  },
  howBtnText: { color: colors.textMain, fontSize: 13, fontWeight: '800' },
  howLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    marginBottom: space.md,
  },
  howLinkText: { color: colors.textDimmed, fontSize: 13, fontWeight: '600' },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  sectionTitle: { color: colors.textMain, fontSize: 20, fontWeight: '800' },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  liveText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },

  // Carte d'une course disponible
  offerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    marginBottom: space.md,
    ...elevation.resting.shadow,
  },
  offerCardDone: { borderColor: stroke.active },
  offerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  distPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,230,118,0.10)',
    borderWidth: strokeWidth.control,
    borderColor: 'rgba(0,230,118,0.22)',
  },
  distText: { color: colors.textMain, fontSize: 12, fontWeight: '700' },
  postedText: { color: colors.textDimmed, fontSize: 11 },

  routeStrip: { flexDirection: 'row', gap: space.sm, marginBottom: space.lg },
  rail: { alignItems: 'center', paddingTop: space.xs, paddingLeft: 1 },
  railDot: { width: 7, height: 7, borderRadius: radius.full, backgroundColor: colors.primary },
  railLine: {
    width: 1,
    flex: 1,
    minHeight: 11,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: space.tight,
  },
  railEnd: {
    width: 5,
    height: 5,
    borderRadius: radius.full,
    borderWidth: strokeWidth.control,
    borderColor: colors.textDimmed,
  },
  routeTexts: { flex: 1, gap: space.xs, minWidth: 0 },
  routeText: { color: colors.textMuted, fontSize: 13, lineHeight: 17 },
  routeDest: { color: colors.textDimmed },

  netBlock: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space.md,
  },
  netLeft: { flexShrink: 1, minWidth: 0 },
  netLabel: {
    color: colors.textDimmed,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: space.xs,
  },
  netValue: {
    color: colors.textMain,
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -1.2,
  },
  netDecimals: {
    color: colors.textMuted,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  tripMeta: { alignItems: 'flex-end', gap: space.tight },
  tripMetaText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },

  grossNote: {
    color: colors.textDimmed,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: space.sm,
  },

  referrerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.lg,
    paddingTop: space.md,
    borderTopWidth: strokeWidth.surface,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  referrerText: { flex: 1, minWidth: 0 },
  referrerNameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  referrerName: { color: colors.textMain, fontSize: 14, fontWeight: '800', flexShrink: 1 },
  verifiedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,230,118,0.12)',
  },
  verifiedText: { color: colors.primary, fontSize: 10, fontWeight: '800' },
  referrerMeta: { color: colors.textDimmed, fontSize: 11.5, marginTop: space.tight },

  acceptBtn: {
    height: 50,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.lg,
  },
  acceptText: { color: colors.onPrimary, fontSize: 15, fontWeight: '800' },
  acceptedStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 50,
    borderRadius: radius.full,
    borderWidth: strokeWidth.control,
    borderColor: stroke.active,
    backgroundColor: 'rgba(0,230,118,0.08)',
    marginTop: space.lg,
    paddingHorizontal: space.md,
  },
  acceptedText: { color: colors.primary, fontSize: 13, fontWeight: '700', flexShrink: 1 },

  // Récap de la semaine
  weekCard: {
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.md,
    padding: space.lg,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edgeLit,
    marginTop: space.lg,
    ...elevation.raised.shadow,
  },
  cardLabel: {
    color: colors.textDimmed,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: space.sm,
  },
  weekTotal: {
    color: colors.textMain,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -1,
    marginBottom: space.lg,
  },
  weekBar: { marginBottom: space.md },
  weekMeta: { color: colors.textDimmed, fontSize: 12, lineHeight: 17 },
});

export default NetworkReceiveScreen;
