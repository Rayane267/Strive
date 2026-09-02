import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import Feather from 'react-native-vector-icons/Feather';
import PlanBadge from '../components/PlanBadge';
import { colors } from '../theme/colors';
import { supabase } from '../services/supabase';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { FREE_THRESHOLDS, getEffectivePlanTier } from '../services/subscriptionService';
import { hapticSuccess, hapticError } from '../utils/haptics';
import { scannerService } from '../services/scanner';
import { fetchFuelPrice } from '../services/fuelService';
import BrandLoader from '../components/BrandLoader';
import SafeGradient from '../components/SafeGradient';
import PlusBadge from '../components/PlusBadge';

const PreferencesScreen = () => {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();
  const { profile } = useAuth();

  /// Payant = 'plus' OU 'premium'. Tout ce que cet ecran verrouille est leve
  /// des Plus : aucun reglage d'ici n'est propre a Premium.
  const isPaid = getEffectivePlanTier(profile) !== 'free';

  /// Virgule decimale en francais. Les curseurs affichaient « 1.10€/km » avec
  /// un point, seul endroit de l'app a le faire.
  const dec = (v: number, digits = 2) => {
    const out = v.toFixed(digits);
    return i18n.language.startsWith('fr') ? out.replace('.', ',') : out;
  };

  // --- ÉTATS ---
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [minHr, setMinHr] = useState(25);
  const [minKm, setMinKm] = useState(1.2);
  const [includePickup, setIncludePickup] = useState(true);
  const [deductFuel, setDeductFuel] = useState(false);
  // computeFuelCost renvoie 0 sans consommation : l'option n'aurait aucun effet.
  const hasFuelData = (profile?.avg_cons ?? 0) > 0;
  /// État AFFICHÉ du toggle carburant. Forcé à off en free — même logique que les
  /// curseurs de seuils, qui montrent FREE_THRESHOLDS plutôt que la valeur stockée.
  /// Un compte free ayant activé l'option avant ce verrou ne la voit donc plus
  /// active, ce qui est honnête : sans données véhicule, elle n'avait aucun effet.
  const fuelToggleOn = isPaid && deductFuel;
  const [useLiveActivity, setUseLiveActivityRaw] = useState(true);
  const setUseLiveActivity = (v: boolean) => {
    setUseLiveActivityRaw(v);
    AsyncStorage.setItem('@strive_use_live_activity', v ? '1' : '0');
    if (Platform.OS === 'ios') {
      const { NativeModules } = require('react-native');
      NativeModules.ScanBridge?.setUseLiveActivity(v);
    }
  };
  const [isActive, setIsActiveRaw] = useState(true);
  // « Trip ID actif » : interrupteur du scanner sur iOS. Écrit un flag lu par la
  // Share Extension + le raccourci AssistiveTouch (refus de scan si OFF).
  // Sur Android le toggle n'est pas affiché (la bulle se pilote via son bouton).
  const setIsActive = (v: boolean) => {
    setIsActiveRaw(v);
    if (Platform.OS === 'ios') {
      const { NativeModules } = require('react-native');
      NativeModules.ScanBridge?.setScannerEnabled?.(v);
    }
  };
  const [dayResetHour, setDayResetHour] = useState<0 | 4>(0);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'error' | 'success' | null }>({ text: '', type: null });

  // --- CHARGEMENT DES DONNÉES ---
  useEffect(() => {
    fetchPreferences();
    AsyncStorage.getItem('@strive_use_live_activity').then(v => {
      if (v !== null) setUseLiveActivityRaw(v === '1');
    });
    // Mount-only : fetchPreferences est stable au premier render, pas de re-fetch voulu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchPreferences = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('preferences')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setMinHr(Number(data.min_hourly_rate));
        setMinKm(Number(data.min_km_rate));
        setIncludePickup(data.include_pickup ?? true); // ON par défaut sauf choix explicite
        setDeductFuel(data.deduct_fuel ?? false);
        setIsActive(data.is_active !== false); // null/undefined → activé par défaut
        if (data.day_reset_hour === 4) setDayResetHour(4);
        else setDayResetHour(0);
      }
    } catch (error: any) {
      __DEV__ && console.error('Error fetching preferences:', error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (statusMessage.type !== null) {
      setStatusMessage({ text: '', type: null });
    }
    // statusMessage.type est exclu volontairement : l'ajouter effacerait le
    // message immédiatement après son affichage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minHr, minKm, includePickup, deductFuel, isActive, dayResetHour]);

  // --- SAUVEGARDE ---
  const handleSave = async () => {
    try {
      setSaving(true);
      setStatusMessage({ text: '', type: null });

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { error } = await supabase.from('preferences').upsert({
        id: user.id,
        min_hourly_rate: minHr,
        min_km_rate: minKm,
        include_pickup: includePickup,
        // `fuelToggleOn` et non `deductFuel` : on persiste ce que l'écran
        // MONTRE. En enregistrant la valeur brute, un compte free (ou qui vient
        // de repasser free) voyait le toggle éteint mais gardait
        // `deduct_fuel = true` en base — et le Dashboard, qui lit la colonne
        // sans contrôle de tier, laissait la déduction carburant active.
        deduct_fuel: fuelToggleOn,
        is_active: isActive,
        day_reset_hour: dayResetHour,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;

      // Propagation immédiate au natif (App Group / bulle) : sans ça le scanner
      // garde l'ancienne valeur jusqu'au prochain focus du Dashboard — un scan
      // lancé juste après l'enregistrement appliquait encore l'ancien réglage
      // (verdict identique includePickup ON/OFF).
      try {
        scannerService.setPreferences(includePickup);
        scannerService.setThresholds(minHr, minKm);
        // Le natif ne connaît ni le type de carburant ni le prix à la pompe :
        // on lui pousse un coût au km déjà calculé (0 = rien à déduire).
        const avgCons = profile?.avg_cons ?? 0;
        const fuelPrice = avgCons > 0
          ? await fetchFuelPrice(profile?.fuel_type ?? 'essence', profile?.elec_price)
          : 0;
        scannerService.setFuelDeduction(
          deductFuel,
          fuelPrice > 0 ? (avgCons / 100) * fuelPrice : 0,
        );
      } catch {}

      hapticSuccess();
      setStatusMessage({ text: t('preferences.saveSuccess', 'Préférences enregistrées avec succès.'), type: 'success' });
      setTimeout(() => {
        if (navigation.canGoBack()) navigation.goBack();
      }, 1500);

    } catch (error: any) {
      hapticError();
      setStatusMessage({ text: t('preferences.saveError', "Impossible d'enregistrer. Réessayez."), type: 'error' });
      __DEV__ && console.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <BrandLoader size={12} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>

      {/* Chevron, titre et pastille sur une seule rangée. Le sous-titre
          « filtres de trajet » disparaît : il paraphrasait le titre sans rien
          ajouter. */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Feather name="chevron-left" size={30} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.screenTitle} numberOfLines={1}>
          {t('preferences.title', 'Préférences')}
        </Text>
        <PlanBadge />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── ACTIVATION (iOS uniquement — interrupteur du scanner) ── */}
        {Platform.OS === 'ios' && (
          <>
            <View style={styles.sectionLabel}>
              
              <Text style={styles.sectionLabelText}>{t('preferences.identification')}</Text>
            </View>

            <View style={styles.card}>
              <View style={styles.toggleRow}>
                <View style={[styles.toggleIconWrap, { backgroundColor: isActive ? 'rgba(0,230,118,0.12)' : 'rgba(255,255,255,0.06)' }]}>
                  <Feather name="zap" size={18} color={isActive ? colors.primary : colors.textDimmed} />
                </View>
                <View style={styles.toggleTextBlock}>
                  <Text style={styles.toggleTitle}>{t('preferences.active', 'Trip ID actif')}</Text>
                  <Text style={styles.toggleSub}>{t('preferences.enableTripIdSub', 'Identification automatique des trajets scannés')}</Text>
                </View>
                <Switch
                  value={isActive}
                  onValueChange={setIsActive}
                  trackColor={{ false: 'rgba(255,255,255,0.08)', true: 'rgba(0,230,118,0.35)' }}
                  thumbColor={isActive ? colors.primary : colors.textDimmed}
                  ios_backgroundColor="rgba(255,255,255,0.08)"
                />
              </View>
            </View>
          </>
        )}


        {/* ── MINIMUMS ── */}
        {/* Badge dans l'en-tête, et pas seulement le cadenas en bas de carte :
            les curseurs sont rendus normalement pour un compte free (juste
            `disabled`), la restriction ne se découvrait donc qu'en essayant
            de les bouger. */}
        <View style={styles.sectionLabel}>
          
          <Text style={styles.sectionLabelText}>{t('preferences.minimums', 'Seuils minimum')}</Text>
          {!isPaid && <PlusBadge />}
        </View>

        <View style={styles.card}>
          {/* Hourly rate */}
          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <View style={styles.sliderLabelRow}>
                <View style={styles.sliderIconWrap}>
                  <Feather name="clock" size={14} color={colors.textMuted} />
                </View>
                <Text style={styles.sliderLabel}>{t('preferences.minHr', 'Tarif/heure min.')}</Text>
              </View>
              <View style={styles.sliderValueBadge}>
                <Text style={styles.sliderValueText}>{(isPaid ? minHr : FREE_THRESHOLDS.hourly)}€/h</Text>
              </View>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={10}
              maximumValue={80}
              step={1}
              value={isPaid ? minHr : FREE_THRESHOLDS.hourly}
              onValueChange={isPaid ? setMinHr : undefined}
              disabled={!isPaid}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor="rgba(255,255,255,0.1)"
              thumbTintColor="#FFF"
            />
            <View style={styles.sliderRange}>
              <Text style={styles.sliderRangeText}>10€</Text>
              <Text style={styles.sliderRangeText}>80€</Text>
            </View>
          </View>

          <View style={styles.cardDivider} />

          {/* Km rate */}
          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <View style={styles.sliderLabelRow}>
                <View style={styles.sliderIconWrap}>
                  <MaterialCommunityIcons name="map-marker-distance" size={14} color={colors.textMuted} />
                </View>
                <Text style={styles.sliderLabel}>{t('preferences.minKm', 'Tarif/km min.')}</Text>
              </View>
              <View style={styles.sliderValueBadge}>
                <Text style={styles.sliderValueText}>{dec(isPaid ? minKm : FREE_THRESHOLDS.km)}€/km</Text>
              </View>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={0.3}
              maximumValue={4.0}
              step={0.05}
              value={isPaid ? minKm : FREE_THRESHOLDS.km}
              onValueChange={isPaid ? setMinKm : undefined}
              disabled={!isPaid}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor="rgba(255,255,255,0.1)"
              thumbTintColor="#FFF"
            />
            <View style={styles.sliderRange}>
              <Text style={styles.sliderRangeText}>{dec(0.3)}€</Text>
              <Text style={styles.sliderRangeText}>{dec(4)}€</Text>
            </View>
          </View>

          {/* Deux vues et non une : le halo doit se dessiner À L'EXTÉRIEUR, or
              la capsule a besoin d'`overflow: hidden` pour découper le dégradé
              sur ses coins ronds. Les deux sur la même vue et Android rogne
              l'ombre avec le reste. */}
          {!isPaid && (
            <View style={styles.thresholdUnlockWrap}>
            <TouchableOpacity
              style={styles.thresholdUnlockCard}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('SubscriptionScreen')}
              accessibilityRole="button"
            >
              {/* Dégradé diagonal très bas — 22 % à 5 % de vert. Il donne un
                  corps à la capsule sans devenir un aplat : le blanc du libellé
                  garde tout son contraste, là où un aplat #00E676 ne laisse
                  passer ni blanc ni noir proprement. */}
              <SafeGradient
                colors={['rgba(0,230,118,0.22)', 'rgba(0,230,118,0.05)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
                pointerEvents="none"
              />
              {/* Un lien, rien de plus. La phrase qui recopiait les valeurs
                  imposees a sauté : elles sont deja affichees dans les pastilles
                  des deux curseurs, juste au-dessus. */}
              <Text style={styles.thresholdUnlockLink}>
                {t('preferences.thresholdLockCta')}
              </Text>
              <Feather name="arrow-up-right" size={15} color={colors.primary} />
            </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── OPTIONS TRAJET ── */}
        <View style={styles.sectionLabel}>
          
          <Text style={styles.sectionLabelText}>{t('preferences.options')}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={[styles.toggleIconWrap, { backgroundColor: dayResetHour === 4 ? 'rgba(0,230,118,0.12)' : 'rgba(255,255,255,0.06)' }]}>
              <MaterialCommunityIcons name="weather-sunset-up" size={18} color={dayResetHour === 4 ? colors.primary : colors.textDimmed} />
            </View>
            <View style={styles.toggleTextBlock}>
              <Text style={styles.toggleTitle}>{t('preferences.dayReset4am', 'Reset à 4h du matin')}</Text>
              <Text style={styles.toggleSub}>{t('preferences.dayReset4amSub', 'Pour les chauffeurs de nuit : la journée commence à 4h locale au lieu de minuit')}</Text>
            </View>
            <Switch
              value={dayResetHour === 4}
              onValueChange={(v) => setDayResetHour(v ? 4 : 0)}
              trackColor={{ false: 'rgba(255,255,255,0.08)', true: 'rgba(0,230,118,0.35)' }}
              thumbColor={dayResetHour === 4 ? colors.primary : colors.textDimmed}
              ios_backgroundColor="rgba(255,255,255,0.08)"
            />
          </View>

          <View style={styles.cardDivider} />

          <View style={styles.toggleRow}>
            <View style={[styles.toggleIconWrap, { backgroundColor: includePickup ? 'rgba(0,230,118,0.12)' : 'rgba(255,255,255,0.06)' }]}>
              <Feather name="map-pin" size={18} color={includePickup ? colors.primary : colors.textDimmed} />
            </View>
            <View style={styles.toggleTextBlock}>
              <Text style={styles.toggleTitle}>{t('preferences.includePickup', 'Inclure la prise en charge')}</Text>
              <Text style={styles.toggleSub}>{t('preferences.includePickupSub', 'Comptabiliser le trajet jusqu\'au client')}</Text>
            </View>
            <Switch
              value={includePickup}
              onValueChange={setIncludePickup}
              trackColor={{ false: 'rgba(255,255,255,0.08)', true: 'rgba(0,230,118,0.35)' }}
              thumbColor={includePickup ? colors.primary : colors.textDimmed}
              ios_backgroundColor="rgba(255,255,255,0.08)"
            />
          </View>

          <View style={styles.cardDivider} />

          {/* Réservé à Plus, et pas seulement signalé : l'option dépend de la
              consommation du véhicule, saisie dans CarSettings — écran verrouillé.
              Un compte free qui l'activait ne voyait rien changer, puis se faisait
              renvoyer vers un écran fermé. On l'affiche donc désactivée, comme les
              curseurs de seuils, et un tap sur la ligne mène au paywall. */}
          <TouchableOpacity
            style={styles.toggleRow}
            activeOpacity={isPaid ? 1 : 0.7}
            disabled={isPaid}
            onPress={() => navigation.navigate('SubscriptionScreen')}
            accessibilityRole={isPaid ? undefined : 'button'}
          >
            <View style={[styles.toggleIconWrap, { backgroundColor: fuelToggleOn ? 'rgba(0,230,118,0.12)' : 'rgba(255,255,255,0.06)' }]}>
              <Feather name="droplet" size={18} color={fuelToggleOn ? colors.primary : colors.textDimmed} />
            </View>
            <View style={styles.toggleTextBlock}>
              <View style={styles.toggleTitleRow}>
                <Text style={styles.toggleTitle}>{t('preferences.deductFuel', 'Retirer le carburant du prix')}</Text>
                {!isPaid && <PlusBadge style={styles.badgeInline} />}
              </View>
              <Text style={styles.toggleSub}>{t('preferences.deductFuelSub', 'Le prix affiché devient net du carburant estimé')}</Text>
            </View>
            <Switch
              value={fuelToggleOn}
              onValueChange={isPaid ? setDeductFuel : undefined}
              disabled={!isPaid}
              trackColor={{ false: 'rgba(255,255,255,0.08)', true: 'rgba(0,230,118,0.35)' }}
              thumbColor={fuelToggleOn ? colors.primary : colors.textDimmed}
              ios_backgroundColor="rgba(255,255,255,0.08)"
            />
          </TouchableOpacity>

          {/* Sans consommation renseignée, computeFuelCost renvoie 0 : l'option
              serait active mais sans effet visible. On le dit, avec le raccourci
              vers l'écran qui manque. */}
          {fuelToggleOn && !hasFuelData && (
            <TouchableOpacity
              style={styles.fuelWarning}
              onPress={() => navigation.navigate('CarSettings' as never)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('preferences.deductFuelMissing', 'Renseignez la consommation de votre véhicule pour que cette option ait un effet.')}
            >
              <Feather name="alert-triangle" size={15} color="#FFB74D" />
              <Text style={styles.fuelWarningTxt}>
                {t('preferences.deductFuelMissing', 'Renseignez la consommation de votre véhicule pour que cette option ait un effet.')}
              </Text>
              <Feather name="chevron-right" size={16} color="#FFB74D" />
            </TouchableOpacity>
          )}

          {Platform.OS === 'ios' && (
            <>
              <View style={styles.cardDivider} />
              <View style={styles.toggleRow}>
                <View style={[styles.toggleIconWrap, { backgroundColor: useLiveActivity ? 'rgba(0,230,118,0.12)' : 'rgba(255,255,255,0.06)' }]}>
                  <MaterialCommunityIcons name="island" size={18} color={useLiveActivity ? colors.primary : colors.textDimmed} />
                </View>
                <View style={styles.toggleTextBlock}>
                  <Text style={styles.toggleTitle}>{t('preferences.resultMode', 'Dynamic Island')}</Text>
                  <Text style={styles.toggleSub}>{t('preferences.resultModeSub', 'Afficher le résultat dans la Dynamic Island. Désactivé = notification classique.')}</Text>
                </View>
                <Switch
                  value={useLiveActivity}
                  onValueChange={setUseLiveActivity}
                  trackColor={{ false: 'rgba(255,255,255,0.08)', true: 'rgba(0,230,118,0.35)' }}
                  thumbColor={useLiveActivity ? colors.primary : colors.textDimmed}
                  ios_backgroundColor="rgba(255,255,255,0.08)"
                />
              </View>
            </>
          )}
        </View>

        {/* ── STATUS MESSAGE ── */}
        {statusMessage.text !== '' && (
          <View style={[styles.statusBox, statusMessage.type === 'error' ? styles.statusError : styles.statusSuccess]}>
            <Feather
              name={statusMessage.type === 'error' ? 'alert-circle' : 'check-circle'}
              size={16}
              color={statusMessage.type === 'error' ? colors.danger : colors.primary}
            />
            <Text style={[styles.statusText, { color: statusMessage.type === 'error' ? colors.danger : colors.primary }]}>
              {statusMessage.text}
            </Text>
          </View>
        )}

        {/* ── SAVE BUTTON ── */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <>
              <Feather name="check" size={20} color={colors.onPrimary} />
              <Text style={styles.saveBtnText}>{t('preferences.save', 'Enregistrer')}</Text>
            </>
          )}
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  // Chevron nu plutôt qu'un carré bordé : le bouton retour n'a pas à peser
  // autant que le titre qu'il précède.
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -10,
  },
  // Le titre occupe l'espace restant entre le chevron et la pastille, et se
  // tronque plutôt que de repousser cette dernière hors de l'écran.
  screenTitle: {
    flex: 1,
    color: colors.textMain,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginLeft: 4,
    marginRight: 12,
  },

  scroll: { paddingHorizontal: 20, paddingBottom: 50 },

  // Libellé de section en casse normale : les capitales espacées faisaient lire
  // une étiquette administrative là où il s'agit d'un simple intertitre. La
  // barrette d'accent disparaît pour la même raison — elle décorait un texte qui
  // n'a pas besoin d'être signalé.
  sectionLabel: {
    // Rangee, et non colonne : la pastille « PLUS » de la section des seuils
    // tombait sous le titre au lieu de se poser a cote, sur une ligne a elle.
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    marginTop: 18,
  },
  sectionLabelText: {
    color: colors.textMuted,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },

  // Cards
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  cardDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginVertical: 16,
  },

  // Toggle rows
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  toggleIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  toggleTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  badgeInline: { alignSelf: 'center' },
  toggleTextBlock: { flex: 1, paddingRight: 12 },
  toggleTitle: { color: colors.textMain, fontSize: 14, fontWeight: '700', marginBottom: 3 },
  toggleSub: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },

  // Avertissement « conso manquante » sous le toggle carburant.
  fuelWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    marginLeft: 54,
    marginRight: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,183,77,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,183,77,0.25)',
  },
  fuelWarningTxt: {
    flex: 1,
    color: '#FFB74D',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },

  // Reset toggle
  resetToggleRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    marginLeft: 54,
  },
  resetOption: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
  },
  resetOptionActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(0,230,118,0.1)',
  },
  resetOptionText: {
    color: colors.textDimmed,
    fontSize: 15,
    fontWeight: '700',
  },
  resetOptionTextActive: {
    color: colors.primary,
  },

  // Sliders
  sliderSection: { paddingBottom: 2 },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sliderLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sliderIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    // Neutre : un slider n'a pas d'état on/off, le vert ne signalerait rien ici.
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  sliderLabel: { color: colors.textMain, fontSize: 14, fontWeight: '700' },
  sliderValueBadge: {
    backgroundColor: 'rgba(0,230,118,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.2)',
  },
  sliderValueText: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  slider: { width: '100%', height: 40, marginVertical: -4 },
  sliderRange: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  sliderRangeText: { color: colors.textDimmed, fontSize: 11, fontWeight: '600' },
  // Contour vert, fond vide, libellé vert.
  //
  // Trois essais avant celui-là, et chacun a éliminé une piste : vert sur vert
  // (illisible, lu comme un élément désactivé) ; fond neutre à libellé blanc
  // (ne ressemble à rien de ce que l'app fait ailleurs) ; aplat vert à encre
  // sombre (la bonne lisibilité, mais l'encre foncée sur une si petite surface
  // fait une tache).
  //
  // Ce qui reste, et qui marche : pas d'aplat du tout. Contour vert, libellé
  // BLANC. Le blanc sur le fond de la carte donne le meilleur contraste des
  // quatre essais — un texte posé sur #00E676 n'y arrive jamais, quelle que
  // soit sa couleur — le contour porte l'accent, et l'écran n'a pas un
  // quatrième aplat vert qui dilue l'emphase des trois autres. C'est le bouton
  // secondaire par défaut : le contour dit « on peut appuyer », le plein reste
  // à l'action primaire, ici « Enregistrer ».
  //
  // `alignSelf` est ce qui l'empêche de s'étirer : sans lui la pastille reprend
  // toute la largeur de la carte et redevient la bannière qu'on vient d'enlever.
  // Le halo, à l'extérieur. Même signature lumineuse que « EN LIGNE » et
  // « Enregistrer », en beaucoup plus discret : c'est ce qui rattache la
  // capsule au reste de l'app sans lui donner le poids d'un bouton primaire.
  thresholdUnlockWrap: {
    alignSelf: 'flex-start',
    marginTop: 16,
    borderRadius: 999,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  thresholdUnlockCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 999,
    // Découpe le dégradé sur les coins ronds.
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.38)',
  },
  thresholdUnlockLink: {
    color: colors.textMain,
    fontSize: 13.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  // Status message
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    marginBottom: 14,
    borderWidth: 1,
  },
  statusError: {
    backgroundColor: 'rgba(255,77,77,0.08)',
    borderColor: 'rgba(255,77,77,0.25)',
  },
  statusSuccess: {
    backgroundColor: 'rgba(0,230,118,0.08)',
    borderColor: 'rgba(0,230,118,0.2)',
  },
  statusText: { fontSize: 13, fontWeight: '600', flex: 1 },

  // Save button
  saveBtn: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 17,
    // Entierement arrondi, comme les pastilles et le CTA du paywall.
    borderRadius: 999,
    marginTop: 6,
    marginBottom: 20,
    gap: 10,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  saveBtnText: {
    color: colors.onPrimary,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});

export default PreferencesScreen;
