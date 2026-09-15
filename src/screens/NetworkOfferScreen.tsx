import React, { useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import ScreenField from '../components/ScreenField';
import AnimatedEntrance from '../components/AnimatedEntrance';
import NetworkDirectionSwitch from '../components/NetworkDirectionSwitch';
import SplitBar from '../components/SplitBar';
import { colors } from '../theme/colors';
import { useMarket } from '../hooks/useMarket';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { stroke, strokeWidth } from '../theme/stroke';
import { elevation } from '../theme/elevation';
import { FIELD_TOP } from '../theme/field';
import { hapticSuccess } from '../utils/haptics';
import {
  CLASSIC_PLATFORM_RATE,
  DEMO_DRIVERS_NEARBY,
  SHARE,
  money,
  parseFare,
  splitFare,
} from '../services/networkDemo';

/**
 * Proposer — le sens sortant du réseau.
 *
 * La situation est précise : le chauffeur a un client au téléphone et il roule
 * déjà. Il ne veut pas perdre l'appel, il ne peut pas prendre la course. Trois
 * champs, et la course part au réseau.
 *
 * Tout l'écran est construit autour d'un seul moment : la répartition
 * s'affiche AVANT le bouton, pas après, et pas dans un menu. Le chauffeur voit
 * ce que devient le prix qu'il vient d'annoncer au client pendant qu'il décide
 * de publier — c'est la seule position où une commission est une information
 * plutôt qu'une mention légale.
 */
const NetworkOfferScreen = () => {
  const market = useMarket();
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();

  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [fareText, setFareText] = useState('52');
  const [published, setPublished] = useState(false);

  const fare = parseFare(fareText);
  const split = splitFare(fare);
  const classicCut = Math.round(fare * CLASSIC_PLATFORM_RATE * 100) / 100;
  const ready = pickup.trim().length > 0 && dropoff.trim().length > 0 && fare > 0;
  const m = (v: number) => money(v, market, i18n.language);

  const publish = () => {
    if (!ready) return;
    Keyboard.dismiss();
    hapticSuccess();
    setPublished(true);
  };

  const reset = () => {
    setPublished(false);
    setPickup('');
    setDropoff('');
    setFareText('52');
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
          active="offer"
          onSwitch={() => navigation.replace('NetworkReceive')}
        />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <AnimatedEntrance step={0}>
            <Text style={styles.intro}>{t('rideNetwork.offer.intro')}</Text>
          </AnimatedEntrance>

          {/* ── LE TRAJET ── */}
          <AnimatedEntrance step={1}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>{t('rideNetwork.offer.tripSection')}</Text>

              <View style={styles.tripRow}>
                {/* Le même rail que l'Historique : les deux adresses se lisent
                    comme un trajet, pas comme deux champs superposés. */}
                <View style={styles.rail}>
                  <View style={styles.railDot} />
                  <View style={styles.railLine} />
                  <View style={styles.railEnd} />
                </View>

                <View style={styles.tripFields}>
                  <View style={styles.inputBox}>
                    <TextInput
                      style={styles.input}
                      value={pickup}
                      onChangeText={setPickup}
                      placeholder={t('rideNetwork.offer.pickupPlaceholder')}
                      placeholderTextColor={colors.textDimmed}
                      editable={!published}
                      returnKeyType="next"
                    />
                  </View>
                  <View style={styles.inputBox}>
                    <TextInput
                      style={styles.input}
                      value={dropoff}
                      onChangeText={setDropoff}
                      placeholder={t('rideNetwork.offer.dropoffPlaceholder')}
                      placeholderTextColor={colors.textDimmed}
                      editable={!published}
                      returnKeyType="done"
                    />
                  </View>
                </View>
              </View>
            </View>
          </AnimatedEntrance>

          {/* ── PRIX CONVENU ── */}
          <AnimatedEntrance step={2}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>{t('rideNetwork.offer.fareSection')}</Text>
              <View style={styles.fareRow}>
                {/* La largeur suit le nombre de caractères. Une largeur fixe
                    laissait le « € » flotter à 40 px du montant sur « 52 », ce
                    qui donnait deux objets au lieu d'un prix. */}
                <TextInput
                  style={[styles.fareInput, { width: Math.max(2, fareText.length) * 21 + 4 }]}
                  value={fareText}
                  onChangeText={setFareText}
                  keyboardType="decimal-pad"
                  editable={!published}
                  maxLength={6}
                  selectTextOnFocus
                />
                <Text style={styles.fareCurrency}>{market.symbol}</Text>
              </View>
              <Text style={styles.cardHint}>{t('rideNetwork.offer.fareHint')}</Text>
            </View>
          </AnimatedEntrance>

          {/* ── RÉPARTITION ── */}
          {/* L'élément focal de l'écran : il part de plus loin et arrive après
              tout le reste. C'est le contenu que l'écran raconte. */}
          <AnimatedEntrance step={3} focal>
            <View style={[styles.card, styles.splitCard]}>
              <Text style={styles.cardLabel}>{t('rideNetwork.offer.splitSection')}</Text>
              <Text style={styles.splitHint}>{t('rideNetwork.offer.splitHint')}</Text>

              <SplitBar
                segments={[
                  {
                    key: 'driver',
                    ratio: SHARE.driver,
                    color: 'rgba(255,255,255,0.28)',
                    label: t('rideNetwork.share.driver'),
                    amount: m(split.driver),
                  },
                  {
                    key: 'referrer',
                    ratio: SHARE.referrer,
                    color: colors.primary,
                    label: t('rideNetwork.offer.shareYou'),
                    amount: m(split.referrer),
                    mine: true,
                  },
                  {
                    key: 'platform',
                    ratio: SHARE.platform,
                    color: colors.textDimmed,
                    label: t('rideNetwork.share.platform'),
                    amount: m(split.platform),
                  },
                ]}
              />

              <View style={styles.compare}>
                <Text style={styles.compareLabel}>
                  {t('rideNetwork.offer.compareTitle')}
                </Text>
                <Text style={styles.compareBody}>
                  {t('rideNetwork.offer.compareBody', {
                    rate: Math.round(CLASSIC_PLATFORM_RATE * 100),
                    amount: m(classicCut),
                    ours: m(split.platform),
                  })}
                </Text>
              </View>
            </View>
          </AnimatedEntrance>

          {published ? (
            <AnimatedEntrance slideDistance={12} duration={240}>
              <View style={styles.doneCard}>
                <Feather name="check-circle" size={22} color={colors.primary} />
                <Text style={styles.doneTitle}>
                  {t('rideNetwork.offer.publishedTitle')}
                </Text>
                <Text style={styles.doneBody}>
                  {t('rideNetwork.offer.publishedBody', { count: DEMO_DRIVERS_NEARBY })}
                </Text>
                <Text style={styles.doneShare}>
                  {t('rideNetwork.offer.publishedShare', { amount: m(split.referrer) })}
                </Text>
                <TouchableOpacity onPress={reset} style={styles.againBtn}>
                  <Text style={styles.againText}>
                    {t('rideNetwork.offer.publishAnother')}
                  </Text>
                </TouchableOpacity>
              </View>
            </AnimatedEntrance>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.cta, !ready && styles.ctaOff]}
                onPress={publish}
                disabled={!ready}
                activeOpacity={0.85}
                accessibilityRole="button"
              >
                <Feather
                  name="send"
                  size={18}
                  color={ready ? colors.onPrimary : colors.textDimmed}
                />
                <Text style={[styles.ctaText, !ready && styles.ctaTextOff]}>
                  {t('rideNetwork.offer.publish')}
                </Text>
              </TouchableOpacity>
              {!ready && (
                <Text style={styles.ctaNote}>{t('rideNetwork.offer.missing')}</Text>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
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
  intro: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: space.lg,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.lg,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
    marginBottom: space.md,
  },
  cardLabel: {
    color: colors.textDimmed,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: space.md,
  },
  cardHint: {
    color: colors.textDimmed,
    fontSize: 12,
    lineHeight: 17,
    marginTop: space.sm,
  },

  tripRow: { flexDirection: 'row', gap: space.md },
  rail: { alignItems: 'center', paddingVertical: 22, paddingLeft: 1 },
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
  tripFields: { flex: 1, gap: space.sm },
  inputBox: {
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radius.sm,
    borderWidth: strokeWidth.control,
    borderColor: stroke.edge,
  },
  input: { color: colors.textMain, fontSize: 15, padding: 0 },

  fareRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  fareInput: {
    color: colors.textMain,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -1,
    padding: 0,
  },
  fareCurrency: { color: colors.textMuted, fontSize: 22, fontWeight: '800' },

  // La carte de la répartition est la seule qui monte d'un cran : c'est elle
  // qui porte le contenu de l'écran, et la hauteur le dit avant le texte.
  splitCard: {
    backgroundColor: colors.surfaceLight,
    borderColor: stroke.edgeLit,
    ...elevation.raised.shadow,
    marginTop: space.sm,
    marginBottom: space.lg,
  },
  splitHint: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: -space.xs,
    marginBottom: space.lg,
  },

  compare: {
    marginTop: space.lg,
    paddingTop: space.md,
    borderTopWidth: strokeWidth.surface,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  compareLabel: {
    color: colors.textDimmed,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: space.xs,
  },
  compareBody: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18 },

  cta: {
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  ctaOff: { backgroundColor: 'rgba(255,255,255,0.06)' },
  ctaText: { color: colors.onPrimary, fontSize: 16, fontWeight: '800' },
  ctaTextOff: { color: colors.textDimmed },
  ctaNote: {
    color: colors.textDimmed,
    fontSize: 12,
    textAlign: 'center',
    marginTop: space.sm,
  },

  doneCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.xl,
    alignItems: 'center',
    borderWidth: strokeWidth.control,
    borderColor: stroke.active,
  },
  doneTitle: {
    color: colors.textMain,
    fontSize: 17,
    fontWeight: '800',
    marginTop: space.md,
  },
  doneBody: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: space.sm,
  },
  doneShare: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
    marginTop: space.md,
  },
  againBtn: { paddingVertical: space.md, marginTop: space.sm },
  againText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});

export default NetworkOfferScreen;
