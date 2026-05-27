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
import { colors } from '../theme/colors';
import { supabase } from '../services/supabase';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { hapticSuccess, hapticError } from '../utils/haptics';
import BrandLoader from '../components/BrandLoader';

const PreferencesScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { profile } = useAuth();

  const tier = profile?.subscription_tier?.toLowerCase();
  const isPremium = tier === 'plus' || tier === 'pro' || tier === 'premium';

  // --- ÉTATS ---
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [minHr, setMinHr] = useState(25);
  const [minKm, setMinKm] = useState(1.25);
  const [includePickup, setIncludePickup] = useState(false);
  const [useLiveActivity, setUseLiveActivityRaw] = useState(true);
  const setUseLiveActivity = (v: boolean) => {
    setUseLiveActivityRaw(v);
    AsyncStorage.setItem('@strive_use_live_activity', v ? '1' : '0');
    if (Platform.OS === 'ios') {
      const { NativeModules } = require('react-native');
      NativeModules.ScanBridge?.setUseLiveActivity(v);
    }
  };
  const [isActive, setIsActive] = useState(true);
  const [dayResetHour, setDayResetHour] = useState<0 | 4>(0);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'error' | 'success' | null }>({ text: '', type: null });

  // --- CHARGEMENT DES DONNÉES ---
  useEffect(() => {
    fetchPreferences();
    AsyncStorage.getItem('@strive_use_live_activity').then(v => {
      if (v !== null) setUseLiveActivityRaw(v === '1');
    });
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
        setIncludePickup(data.include_pickup);
        setIsActive(data.is_active);
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
  }, [minHr, minKm, includePickup, isActive, dayResetHour]);

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
        is_active: isActive,
        day_reset_hour: dayResetHour,
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;

      hapticSuccess();
      setStatusMessage({ text: t('preferences.saveSuccess', 'Préférences enregistrées avec succès.'), type: 'success' });
      setTimeout(() => navigation.goBack(), 1500);

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

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.textMain} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('preferences.title', 'Préférences')}</Text>
          <Text style={styles.headerSub}>{t('preferences.subtitle', 'Filtres de trajet')}</Text>
        </View>
        <View style={[styles.planBadge, isPremium && styles.planBadgePlus]}>
          {isPremium && <MaterialCommunityIcons name="crown" size={11} color={colors.background} style={{ marginRight: 4 }} />}
          <Text style={[styles.planBadgeText, isPremium && styles.planBadgeTextPlus]}>
            {isPremium ? 'PLUS' : 'FREE'}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── ACTIVATION ── */}
        <View style={styles.sectionLabel}>
          <View style={styles.sectionAccent} />
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


        {/* ── MINIMUMS ── */}
        <View style={styles.sectionLabel}>
          <View style={styles.sectionAccent} />
          <Text style={styles.sectionLabelText}>{t('preferences.minimums', 'SEUILS MINIMUM').toUpperCase()}</Text>
        </View>

        <View style={styles.card}>
          {/* Hourly rate */}
          <View style={styles.sliderSection}>
            <View style={styles.sliderHeader}>
              <View style={styles.sliderLabelRow}>
                <View style={[styles.sliderIconWrap, { backgroundColor: 'rgba(0,230,118,0.1)' }]}>
                  <Feather name="clock" size={14} color={colors.primary} />
                </View>
                <Text style={styles.sliderLabel}>{t('preferences.minHr', 'Tarif/heure min.')}</Text>
              </View>
              <View style={styles.sliderValueBadge}>
                <Text style={styles.sliderValueText}>{minHr}€/h</Text>
              </View>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={10}
              maximumValue={80}
              step={1}
              value={minHr}
              onValueChange={setMinHr}
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
                <View style={[styles.sliderIconWrap, { backgroundColor: 'rgba(0,230,118,0.1)' }]}>
                  <MaterialCommunityIcons name="map-marker-distance" size={14} color={colors.primary} />
                </View>
                <Text style={styles.sliderLabel}>{t('preferences.minKm', 'Tarif/km min.')}</Text>
              </View>
              <View style={styles.sliderValueBadge}>
                <Text style={styles.sliderValueText}>{minKm.toFixed(2)}€/km</Text>
              </View>
            </View>
            <Slider
              style={styles.slider}
              minimumValue={0.3}
              maximumValue={4.0}
              step={0.05}
              value={minKm}
              onValueChange={setMinKm}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor="rgba(255,255,255,0.1)"
              thumbTintColor="#FFF"
            />
            <View style={styles.sliderRange}>
              <Text style={styles.sliderRangeText}>0.30€</Text>
              <Text style={styles.sliderRangeText}>4.00€</Text>
            </View>
          </View>
        </View>

        {/* ── OPTIONS TRAJET ── */}
        <View style={styles.sectionLabel}>
          <View style={styles.sectionAccent} />
          <Text style={styles.sectionLabelText}>{t('preferences.options')}</Text>
        </View>

        <View style={styles.optionCard}>
          <View style={[styles.optionIconCircle, { backgroundColor: 'rgba(255,183,77,0.12)' }]}>
            <MaterialCommunityIcons name="weather-sunset-up" size={22} color="#FFB74D" />
          </View>
          <View style={styles.optionContent}>
            <Text style={styles.optionTitle}>{t('preferences.dayReset4am', 'Reset à 4h du matin')}</Text>
            <Text style={styles.optionSub}>{t('preferences.dayReset4amSub', 'Pour les chauffeurs de nuit')}</Text>
          </View>
          <Switch
            value={dayResetHour === 4}
            onValueChange={(v) => setDayResetHour(v ? 4 : 0)}
            trackColor={{ false: 'rgba(255,255,255,0.08)', true: 'rgba(255,183,77,0.4)' }}
            thumbColor={dayResetHour === 4 ? '#FFB74D' : colors.textDimmed}
            ios_backgroundColor="rgba(255,255,255,0.08)"
          />
        </View>

        <View style={styles.optionCard}>
          <View style={[styles.optionIconCircle, { backgroundColor: 'rgba(79,195,247,0.12)' }]}>
            <MaterialCommunityIcons name="map-marker-radius" size={22} color="#4FC3F7" />
          </View>
          <View style={styles.optionContent}>
            <Text style={styles.optionTitle}>{t('preferences.includePickup', 'Inclure la prise en charge')}</Text>
            <Text style={styles.optionSub}>{t('preferences.includePickupSub', 'Comptabiliser le trajet jusqu\'au client')}</Text>
          </View>
          <Switch
            value={includePickup}
            onValueChange={setIncludePickup}
            trackColor={{ false: 'rgba(255,255,255,0.08)', true: 'rgba(79,195,247,0.4)' }}
            thumbColor={includePickup ? '#4FC3F7' : colors.textDimmed}
            ios_backgroundColor="rgba(255,255,255,0.08)"
          />
        </View>

        {Platform.OS === 'ios' && (
          <View style={styles.optionCard}>
            <View style={[styles.optionIconCircle, { backgroundColor: 'rgba(171,71,188,0.12)' }]}>
              <MaterialCommunityIcons name="island" size={22} color="#AB47BC" />
            </View>
            <View style={styles.optionContent}>
              <Text style={styles.optionTitle}>{t('preferences.resultMode', 'Dynamic Island')}</Text>
              <Text style={styles.optionSub}>{t('preferences.resultModeSub', 'Désactivé = notification classique')}</Text>
            </View>
            <Switch
              value={useLiveActivity}
              onValueChange={setUseLiveActivity}
              trackColor={{ false: 'rgba(255,255,255,0.08)', true: 'rgba(171,71,188,0.4)' }}
              thumbColor={useLiveActivity ? '#AB47BC' : colors.textDimmed}
              ios_backgroundColor="rgba(255,255,255,0.08)"
            />
          </View>
        )}

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
            <ActivityIndicator color={colors.background} />
          ) : (
            <>
              <Feather name="check" size={20} color={colors.background} />
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
  planBadgePlus: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  planBadgeText: { color: colors.textDimmed, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  planBadgeTextPlus: { color: colors.background },

  scroll: { paddingHorizontal: 20, paddingBottom: 50 },

  // Section labels
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    marginTop: 6,
  },
  sectionAccent: {
    width: 3,
    height: 12,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  sectionLabelText: {
    color: colors.textDimmed,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
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
  toggleTextBlock: { flex: 1, paddingRight: 12 },
  toggleTitle: { color: colors.textMain, fontSize: 14, fontWeight: '700', marginBottom: 3 },
  toggleSub: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },

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
  saveBtnText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  optionIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  optionContent: {
    flex: 1,
    marginRight: 10,
  },
  optionTitle: {
    color: colors.textMain,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 3,
  },
  optionSub: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
});

export default PreferencesScreen;
