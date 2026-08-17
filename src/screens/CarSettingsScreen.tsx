import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Keyboard,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import PlanBadge from '../components/PlanBadge';
import { colors } from '../theme/colors';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import * as Sentry from '@sentry/react-native';
import { supabase } from '../services/supabase';
import { updateProfile } from '../services/profileService';
import { useAuth } from '../context/AuthContext';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { getEffectivePlanTier } from '../services/subscriptionService';
import { hapticSuccess, hapticError } from '../utils/haptics';
import { Toast, useToast } from '../components/Toast';

const YEARS = Array.from({ length: 17 }, (_, i) =>
  (new Date().getFullYear() - i).toString(),
);

const BoltCombobox = ({ data, value, onSelect, placeholder, label, isLoading, isOpen, onOpen, zIndex }: any) => {
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState(value);

  useEffect(() => { setSearchText(value); }, [value]);

  const filteredData = (searchText === value || searchText === '')
    ? data
    : data.filter((item: string) => item.toLowerCase().includes(searchText.toLowerCase()));

  return (
    <View style={[styles.comboboxContainer, { zIndex }]}>
      {label && <Text style={styles.inputLabel}>{label}</Text>}
      <View style={[styles.comboboxInputWrapper, isOpen && styles.comboboxInputWrapperOpen]}>
        <TextInput
          style={styles.comboboxInput}
          value={searchText}
          onChangeText={text => { setSearchText(text); onOpen(); }}
          onFocus={onOpen}
          placeholder={placeholder}
          placeholderTextColor={colors.textDimmed}
          selectTextOnFocus
        />
        {isLoading ? (
          <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 8 }} />
        ) : (
          <TouchableOpacity onPress={onOpen} style={{ marginLeft: 8 }}>
            <Feather name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>
      {isOpen && (
        <View style={styles.listContainer}>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 220 }}>
            {filteredData.length > 0 ? (
              filteredData.map((item: string, index: number) => (
                <TouchableOpacity
                  key={index}
                  style={styles.listItem}
                  onPress={() => { setSearchText(item); onSelect(item); Keyboard.dismiss(); }}
                >
                  <Text style={styles.listItemText}>{item}</Text>
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.noResultText}>{t('carSettings.noResult')}</Text>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
};

// Stocké en DB = clé stable ('essence'|'diesel'|'electric'), affiché en UI = label traduit.
// Permet de respecter le CHECK constraint Supabase et de switch FR↔EN sans perdre la valeur.
const FUEL_KEYS = ['essence', 'diesel', 'electric'] as const;
type FuelKey = typeof FUEL_KEYS[number];

const CarSettingsScreen = () => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const { user, profile, refreshProfile } = useAuth();
  const { isConnected } = useNetworkStatus();

  const isPremium = getEffectivePlanTier(profile) !== 'free';

  const FUEL_LABEL: Record<FuelKey, string> = {
    essence: t('settings.fuel.essence'),
    diesel: t('settings.fuel.diesel'),
    electric: t('settings.fuel.electric'),
  };
  const FUEL_TYPES = FUEL_KEYS.map(k => FUEL_LABEL[k]);
  const labelToKey = (label: string): FuelKey =>
    (FUEL_KEYS.find(k => FUEL_LABEL[k] === label) ?? 'essence');

  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('2022');
  const [regNum, setRegNum] = useState('');
  const [fuelType, setFuelType] = useState<FuelKey>('essence');
  const [avgCons, setAvgCons] = useState('');
  const [elecPrice, setElecPrice] = useState('');
  const { toast, showToast, dismissToast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<'make' | 'model' | 'year' | 'fuel' | null>(null);
  const [availableMakes, setAvailableMakes] = useState<string[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingMakes, setIsLoadingMakes] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  // Signature des champs éditables → « dirty state ». Le bouton Enregistrer ne
  // s'active que si la valeur courante diffère de la dernière valeur chargée/sauvée.
  const sigOf = (f: { make: string; model: string; year: string; regNum: string; fuelType: string; avgCons: string; elecPrice: string }) =>
    JSON.stringify([f.make, f.model, f.year, f.regNum, f.fuelType, f.avgCons.trim(), f.elecPrice.trim()]);
  const currentSig = sigOf({ make, model, year, regNum, fuelType, avgCons, elecPrice });
  const [savedSig, setSavedSig] = useState(() => sigOf({ make: '', model: '', year: '2022', regNum: '', fuelType: 'essence', avgCons: '', elecPrice: '' }));
  const isDirty = currentSig !== savedSig;

  useEffect(() => {
    if (profile) {
      const next = {
        make: profile.car_make || '',
        model: profile.car_model || '',
        year: profile.car_year || '2022',
        regNum: profile.car_reg || '',
        fuelType: (profile.fuel_type && (FUEL_KEYS as readonly string[]).includes(profile.fuel_type)) ? (profile.fuel_type as FuelKey) : 'essence',
        avgCons: profile.avg_cons ? profile.avg_cons.toString() : '',
        elecPrice: profile.elec_price ? profile.elec_price.toString() : '',
      };
      setMake(next.make);
      setModel(next.model);
      setYear(next.year);
      setRegNum(next.regNum);
      setFuelType(next.fuelType);
      setAvgCons(next.avgCons);
      setElecPrice(next.elecPrice);
      setSavedSig(sigOf(next));
    }
  }, [profile]); // eslint-disable-line react-hooks/exhaustive-deps

  // Garde-fou : prévient avant de quitter avec des modifs non enregistrées.
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      if (!isDirty || isSaving) return;
      e.preventDefault();
      Alert.alert(
        t('common.unsavedTitle', 'Modifications non enregistrées'),
        t('common.unsavedMessage', 'Voulez-vous quitter sans enregistrer vos changements ?'),
        [
          { text: t('common.stay', 'Rester'), style: 'cancel' },
          { text: t('common.leave', 'Quitter'), style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ],
      );
    });
    return unsub;
  }, [navigation, isDirty, isSaving, t]);

  useEffect(() => {
    const fetchMakes = async () => {
      setIsLoadingMakes(true);
      const { data, error } = await supabase.from('vehicles_db').select('make');
      if (error) __DEV__ && console.error('Erreur marques :', error);
      if (data) setAvailableMakes(Array.from(new Set(data.map(d => d.make))).sort() as string[]);
      setIsLoadingMakes(false);
    };
    fetchMakes();
  }, []);

  useEffect(() => {
    const fetchModels = async () => {
      if (!make) { setAvailableModels([]); return; }
      setIsLoadingModels(true);
      const { data, error } = await supabase.from('vehicles_db').select('model').eq('make', make).order('model', { ascending: true });
      if (error) __DEV__ && console.error('Erreur modèles :', error);
      if (data) setAvailableModels([...Array.from(new Set(data.map(d => d.model))), t('carSettings.otherManual')]);
      setIsLoadingModels(false);
    };
    fetchModels();
  }, [make, t]);

  const handleSave = async () => {
    // Hors-ligne : message clair plutôt qu'une erreur générique trompeuse.
    if (!isConnected) {
      hapticError();
      showToast({ type: 'warning', title: t('common.offlineTitle', 'Hors ligne'), message: t('common.offlineSave', 'Pas de connexion. Vos modifications seront à réenregistrer une fois en ligne.') });
      return;
    }
    // Seuls make + model sont obligatoires. avgCons / year / fuelType / regNum optionnels.
    if (!make || !model) {
      hapticError();
      showToast({ type: 'error', title: t('common.error', 'Erreur'), message: t('carSettings.errors.required', 'Veuillez remplir tous les champs obligatoires.') });
      return;
    }
    // Si l'user a saisi une conso, on la valide. Sinon → null (optionnel).
    let consToSave: number | null = null;
    if (avgCons.trim() !== '') {
      const parsedCons = parseFloat(avgCons.replace(',', '.'));
      if (isNaN(parsedCons) || parsedCons <= 0 || parsedCons > 99.9) {
        hapticError();
        showToast({ type: 'error', title: t('common.error', 'Erreur'), message: t('carSettings.errors.consInvalid', 'Consommation invalide (entre 0.1 et 99.9).') });
        return;
      }
      consToSave = parsedCons;
    }
    // Prix €/kWh (électrique uniquement). Optionnel → null si vide.
    let elecPriceToSave: number | null = null;
    if (fuelType === 'electric' && elecPrice.trim() !== '') {
      const parsedPrice = parseFloat(elecPrice.replace(',', '.'));
      if (isNaN(parsedPrice) || parsedPrice <= 0 || parsedPrice > 3) {
        hapticError();
        showToast({ type: 'error', title: t('common.error', 'Erreur'), message: t('carSettings.errors.priceInvalid', 'Prix invalide (entre 0.01 et 3 €/kWh).') });
        return;
      }
      elecPriceToSave = parsedPrice;
    }
    setIsSaving(true);
    try {
      if (!user) throw new Error('Non connecté');
      await updateProfile(user.id, {
        car_make: make,
        car_model: model,
        car_year: year || null,
        car_reg: regNum || null,
        fuel_type: fuelType || null,
        avg_cons: consToSave,
        elec_price: elecPriceToSave,
      });
      hapticSuccess();
      // Rafraîchit le profile global pour que la prochaine ouverture pré-remplisse les champs.
      if (refreshProfile) await refreshProfile();
      setSavedSig(currentSig); // form « propre » → bouton re-grisé
      showToast({ type: 'success', title: t('common.success', 'Succès'), message: t('carSettings.success.saved', 'Véhicule mis à jour avec succès.') });
    } catch (error: any) {
      hapticError();
      __DEV__ && console.error('[CAR_SAVE] error:', error?.code, error?.message, error?.details, error?.hint);
      Sentry.captureException(error, { tags: { flow: 'car_save' } });
      showToast({ type: 'error', title: t('common.error', 'Erreur'), message: t('carSettings.errors.saveFailed', 'Impossible d\'enregistrer. Réessayez.') });
    } finally {
      setIsSaving(false);
    }
  };

  const closeDropdowns = () => { setOpenDropdown(null); Keyboard.dismiss(); };

  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Toast data={toast} onDismiss={dismissToast} bottomOffset={40} />

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('common.back', 'Retour')}>
          <Feather name="arrow-left" size={22} color={colors.textMain} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('settings.title', 'Mon véhicule')}</Text>
          <Text style={styles.headerSub}>{t('settings.subtitle', 'Informations du véhicule')}</Text>
        </View>
        <PlanBadge />
      </View>

      <View style={{ flex: 1, position: 'relative' }}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(insets.bottom, 20) + 30 },
          ]}
          keyboardShouldPersistTaps="handled"
          onScroll={closeDropdowns}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity activeOpacity={1} onPress={closeDropdowns}>

            {/* ── VÉHICULE ── */}
            <View style={styles.sectionLabel}>
              <View style={styles.sectionAccent} />
              <Text style={styles.sectionLabelText}>{t('settings.vehInfo', 'VÉHICULE').toUpperCase()}</Text>
            </View>

            <View style={[styles.card, { zIndex: 10 }]}>
              <BoltCombobox
                label={t('carSettings.makeLabel', 'Marque')}
                placeholder={t('carSettings.makePlaceholder', 'Rechercher une marque...')}
                data={availableMakes}
                value={make}
                isLoading={isLoadingMakes}
                isOpen={openDropdown === 'make'}
                onOpen={() => setOpenDropdown('make')}
                zIndex={4000}
                onSelect={(v: string) => { setMake(v); setModel(''); setOpenDropdown(null); }}
              />
              <BoltCombobox
                label={t('carSettings.modelLabel', 'Modèle')}
                placeholder={t('carSettings.modelPlaceholder', 'Rechercher un modèle...')}
                data={availableModels}
                value={model}
                isLoading={isLoadingModels}
                isOpen={openDropdown === 'model'}
                onOpen={() => setOpenDropdown('model')}
                zIndex={3000}
                onSelect={(v: string) => { setModel(v); setOpenDropdown(null); }}
              />

              <View style={[styles.row, { zIndex: 2000 }]}>
                <View style={{ flex: 1, marginRight: 10 }}>
                  <BoltCombobox
                    label={t('settings.year', 'Année')}
                    placeholder="2022"
                    data={YEARS}
                    value={year}
                    isOpen={openDropdown === 'year'}
                    onOpen={() => setOpenDropdown('year')}
                    zIndex={2000}
                    onSelect={(v: string) => { setYear(v); setOpenDropdown(null); }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <BoltCombobox
                    label={t('settings.fuelType', 'Carburant')}
                    placeholder={t('carSettings.fuelPlaceholder', 'Type...')}
                    data={FUEL_TYPES}
                    value={FUEL_LABEL[fuelType]}
                    isOpen={openDropdown === 'fuel'}
                    onOpen={() => setOpenDropdown('fuel')}
                    zIndex={1000}
                    onSelect={(v: string) => { setFuelType(labelToKey(v)); setOpenDropdown(null); }}
                  />
                </View>
              </View>

              <Text style={styles.inputLabel}>{t('carSettings.regLabel', 'Immatriculation')}</Text>
              <TextInput
                style={styles.input}
                value={regNum}
                onChangeText={text => setRegNum(text.replace(/[^a-zA-Z0-9\-]/g, '').toUpperCase().slice(0, 10))}
                placeholder="AB-123-CD"
                placeholderTextColor={colors.textDimmed}
                autoCapitalize="characters"
                maxLength={10}
                onFocus={() => setOpenDropdown(null)}
              />
            </View>

            {/* ── CONSOMMATION ── */}
            <View style={styles.sectionLabel}>
              <View style={styles.sectionAccent} />
              <Text style={styles.sectionLabelText}>{t('settings.consumption', 'CONSOMMATION').toUpperCase()}</Text>
            </View>

            <View style={[styles.card, { zIndex: 1 }]}>
              <View style={styles.consRow}>
                <View style={styles.consLeft}>
                  <View style={styles.consIconWrap}>
                    <MaterialCommunityIcons
                      name={fuelType === 'electric' ? 'lightning-bolt' : 'gas-station'}
                      size={18}
                      color={colors.primary}
                    />
                  </View>
                  <View>
                    <Text style={styles.consTitle}>{t('settings.avgCons', 'Consommation moy.')}</Text>
                    <Text style={styles.consSub}>
                      {fuelType === 'electric' ? 'kWh/100km' : 'L/100km'}
                    </Text>
                  </View>
                </View>
                <TextInput
                  style={styles.smallInput}
                  value={avgCons}
                  onChangeText={text => {
                    let cleaned = text.replace(',', '.').replace(/[^0-9.]/g, '');
                    const parts = cleaned.split('.');
                    if (parts.length > 2) cleaned = parts[0] + '.' + parts.slice(1).join('');
                    if (parts[1] !== undefined && parts[1].length > 1) cleaned = parts[0] + '.' + parts[1].slice(0, 1);
                    setAvgCons(cleaned);
                  }}
                  onBlur={() => {
                    if (avgCons) {
                      const parsed = parseFloat(avgCons);
                      if (!isNaN(parsed)) setAvgCons(parsed.toFixed(1));
                    }
                  }}
                  keyboardType="decimal-pad"
                  placeholder="0.0"
                  placeholderTextColor={colors.textDimmed}
                  maxLength={4}
                  onFocus={() => setOpenDropdown(null)}
                />
              </View>

              {fuelType === 'electric' && (
                <>
                  <View style={styles.cardDivider} />
                  <View style={styles.consRow}>
                    <View style={styles.consLeft}>
                      <View style={styles.consIconWrap}>
                        <MaterialCommunityIcons name="currency-eur" size={18} color={colors.primary} />
                      </View>
                      <View>
                        <Text style={styles.consTitle}>{t('carSettings.elecPrice', 'Prix de recharge')}</Text>
                        <Text style={styles.consSub}>€/kWh</Text>
                      </View>
                    </View>
                    <TextInput
                      style={styles.smallInput}
                      value={elecPrice}
                      onChangeText={text => {
                        let cleaned = text.replace(',', '.').replace(/[^0-9.]/g, '');
                        const parts = cleaned.split('.');
                        if (parts.length > 2) cleaned = parts[0] + '.' + parts.slice(1).join('');
                        if (parts[1] !== undefined && parts[1].length > 2) cleaned = parts[0] + '.' + parts[1].slice(0, 2);
                        setElecPrice(cleaned);
                      }}
                      keyboardType="decimal-pad"
                      placeholder="0.25"
                      placeholderTextColor={colors.textDimmed}
                      maxLength={4}
                      onFocus={() => setOpenDropdown(null)}
                    />
                  </View>
                </>
              )}
            </View>

            {/* ── SAVE ── */}
            <TouchableOpacity
              style={[styles.saveBtn, (isSaving || !isDirty) && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={isSaving || !isDirty}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('settings.save', 'Enregistrer')}
              accessibilityState={{ disabled: isSaving || !isDirty }}
            >
              {isSaving ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <>
                  <Feather name="check" size={20} color={colors.background} />
                  <Text style={styles.saveBtnText}>{t('settings.save', 'Enregistrer')}</Text>
                </>
              )}
            </TouchableOpacity>

          </TouchableOpacity>
        </ScrollView>

        {!isPremium && (
          <TouchableOpacity
            style={[StyleSheet.absoluteFill, { zIndex: 10000, elevation: 100, backgroundColor: 'transparent' }]}
            activeOpacity={1}
            onPress={() => navigation.navigate('SubscriptionScreen')}
          />
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  backBtn: {
    width: 38,
    height: 38,
    backgroundColor: colors.surface,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  headerCenter: { flex: 1, marginHorizontal: 14 },
  headerTitle: { color: colors.textMain, fontSize: 17, fontWeight: '800' },
  headerSub: { color: colors.textDimmed, fontSize: 12, marginTop: 2 },
  planBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  planBadgePlus: { backgroundColor: colors.primary, borderColor: colors.primary },
  planBadgeText: { color: colors.textDimmed, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  planBadgeTextPlus: { color: colors.background },

  scroll: { paddingHorizontal: 20 },

  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    marginTop: 6,
  },
  sectionAccent: { width: 3, height: 12, borderRadius: 2, backgroundColor: colors.primary },
  sectionLabelText: { color: colors.textDimmed, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, flex: 1 },

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
  cardDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 14 },
  row: { flexDirection: 'row' },

  inputLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 8 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    color: colors.textMain,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    fontWeight: '600',
  },

  consRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  consLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  consIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: 'rgba(0,230,118,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  consTitle: { color: colors.textMain, fontSize: 14, fontWeight: '700', marginBottom: 3 },
  consSub: { color: colors.textMuted, fontSize: 12 },
  smallInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    color: colors.textMain,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: '800',
    width: 78,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },

  proBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  proBadgeText: { color: colors.background, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },

  proRow: { flexDirection: 'row', alignItems: 'center' },
  proIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  proText: { flex: 1, paddingRight: 12 },
  proTitle: { color: colors.textMuted, fontSize: 14, fontWeight: '700', marginBottom: 3 },
  proSub: { color: colors.textDimmed, fontSize: 12 },

  saveBtn: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 17,
    borderRadius: 16,
    marginTop: 6,
    marginBottom: 20,
    gap: 10,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  saveBtnText: { color: colors.background, fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  saveBtnDisabled: { opacity: 0.4, shadowOpacity: 0, elevation: 0 },

  comboboxContainer: { marginBottom: 14 },
  comboboxInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
  },
  comboboxInputWrapperOpen: {
    borderColor: colors.primary,
    borderBottomWidth: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  comboboxInput: { flex: 1, color: colors.textMain, fontSize: 15, fontWeight: '600', height: '100%' },
  listContainer: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    borderTopWidth: 0,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  listItem: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  listItemText: { color: colors.textMain, fontSize: 15 },
  noResultText: { color: colors.textMuted, padding: 15, textAlign: 'center', fontStyle: 'italic' },
});

export default CarSettingsScreen;
