import React, { useEffect, useRef } from 'react';
import * as Sentry from '@sentry/react-native';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Feather from 'react-native-vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { hapticLight } from '../utils/haptics';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { useAuth } from '../context/AuthContext';
import { updateProfile } from '../services/profileService';
import { supabase } from '../services/supabase';
import { scannerService } from '../services/scanner';
import {
  MARKETS,
  LANGUAGE_NAMES,
  CURRENCY_CODE,
  countryForCurrency,
  type CountryCode,
  type Currency,
} from '../utils/market';
import { SUPPORTED } from '../i18n';

/**
 * Choix de la langue, en feuille montant du bas.
 *
 * Remplace la bascule directe au tap : avec deux langues elle suffisait, mais
 * elle ne disait pas ce qu'elle allait faire — on découvrait le résultat après
 * coup. Une feuille montre les options avant de choisir.
 *
 * « Langue de l'appareil » n'est pas une langue de plus : c'est l'effacement
 * du choix explicite, après quoi l'app suit de nouveau le réglage du téléphone.
 * C'est la valeur par défaut à l'installation, et rien ne permettait d'y revenir
 * une fois une langue choisie à la main.
 *
 * ── DEUX TEMPS : LA LANGUE, PUIS LE PAYS ───────────────────────────────────
 * La langue ne dit pas le pays, et c'est le pays qui porte la devise, l'unité de
 * distance et le régime de cotisations. `fr` ne sépare pas la France de la
 * Belgique ni de la Suisse ; `nl` ne sépare pas les Pays-Bas de la Belgique ;
 * `pt` et `es` débordent largement l'Europe. Deviner l'un depuis l'autre,
 * c'était calculer le seuil de rentabilité d'un chauffeur bruxellois avec les
 * cotisations françaises.
 *
 * La seconde étape ne se saute donc pas après un changement de langue : c'est
 * le seul moment où le chauffeur a une raison de se poser la question, et il
 * voit la devise qu'il va lire partout ensuite.
 */

const STORE_LANGUAGE_KEY = 'user_language';
const DURATION = 260;

const LanguageSheet = ({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const { user, profile, refreshProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;

  // Suivre l'appareil signifie « aucun choix stocké » : l'état ne se lit donc
  // pas dans i18n, qui affiche toujours une langue concrète.
  const [followsDevice, setFollowsDevice] = React.useState(false);
  /**
   * `lang` puis `market`. `country` est un DÉTOUR, pas une étape : on n'y va que
   * si le chauffeur dit que le pays affiché sous sa devise n'est pas le sien.
   */
  const [step, setStep] = React.useState<'lang' | 'market' | 'country'>('lang');
  const [savingCountry, setSavingCountry] = React.useState(false);

  useEffect(() => {
    if (!visible) return;
    // Rouvrir la feuille repart de la langue : c'est ce que le chauffeur vient
    // chercher, et l'étape pays n'a de sens qu'à la suite d'un choix.
    setStep('lang');
    AsyncStorage.getItem(STORE_LANGUAGE_KEY).then(v => setFollowsDevice(!v));
  }, [visible]);

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : DURATION,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [visible, anim, reduceMotion]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [520, 0] });

  const apply = async (lang: string | null) => {
    hapticLight();
    if (lang === null) {
      // Effacer la clé AVANT de changer de langue : `cacheUserLanguage` la
      // réécrirait aussitôt, et le choix « suivre l'appareil » ne survivrait pas
      // au prochain démarrage.
      await AsyncStorage.removeItem(STORE_LANGUAGE_KEY);
      const device = (NativeModules.SettingsManager?.settings?.AppleLocale
        || NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
        || NativeModules.I18nManager?.localeIdentifier
        || 'en').slice(0, 2);
      const next = (SUPPORTED as readonly string[]).includes(device) ? device : 'en';
      await i18n.changeLanguage(next);
      await AsyncStorage.removeItem(STORE_LANGUAGE_KEY);
      pushToNative(next);
    } else if (lang !== i18n.language) {
      await i18n.changeLanguage(lang);
      pushToNative(lang);
    }
    setStep('market');
  };

  /**
   * Le pays fixe la devise, l'unité de distance, le régime de cotisations et le
   * plancher de rentabilité. Écrit sur le profil : il PRIME sur la région de
   * l'appareil, qui n'était qu'une valeur par défaut.
   */
  /** « France », « Portugal »… dans la langue de l'app. */
  const countryName = (code: CountryCode) => t(`countries.${code.toLowerCase()}`, code);

  /**
   * Les devises proposées, avec les pays qu'elles recouvrent.
   *
   * Dérivée de `MARKETS` et non listée à la main : ajouter un marché ajoute sa
   * devise ici, ou le range sous celle qui existe déjà, sans rien à retoucher.
   */
  const currencies = React.useMemo(() => {
    const byCurrency = new Map<Currency, CountryCode[]>();
    for (const code of Object.keys(MARKETS) as CountryCode[]) {
      const cur = MARKETS[code].currency;
      byCurrency.set(cur, [...(byCurrency.get(cur) ?? []), code]);
    }
    return [...byCurrency.entries()];
  }, []);

  /**
   * Une devise choisie s'applique tout de suite — aucune question de plus.
   *
   * Le pays est DÉDUIT (`countryForCurrency` : région de l'appareil, puis
   * langue), et il porte trois choses qu'une devise ne dit pas — le géocodage
   * des adresses, la source du prix du carburant et le plancher de rentabilité.
   * L'euro couvrant quatre pays, cette déduction peut tomber à côté.
   *
   * D'où le pays écrit SOUS chaque devise, et « Ce n'est pas mon pays ? » qui
   * mène à la liste complète. La déduction reste le chemin court parce qu'elle
   * est juste presque toujours ; elle n'est simplement plus muette, et c'est ce
   * silence-là qui était le vrai défaut : un chiffre faux qu'on voit se corrige,
   * un chiffre faux qu'on ne voit pas se propage.
   *
   * Le régime de cotisations, lui, reste demandé en clair à l'onboarding —
   * c'est le chauffeur qui le connaît, pas son fuseau.
   */
  /**
   * Le pays qu'une devise donnera — le RÉGLAGE D'ABORD, la déduction ensuite.
   *
   * `countryForCurrency` seul suffisait tant que la feuille ne montrait rien :
   * il déduit de la région de l'appareil, puis de la langue. Mais un chauffeur
   * belge dont le téléphone est configuré en France a `profiles.country = 'BE'`
   * et se voyait proposer « France » sous l'euro — sa propre devise, déjà
   * sélectionnée. Un tap dessus pour vérifier, et il passait en France : seuils
   * remis de 15 €/h à 25 €/h et adresses géocodées dans le mauvais pays, pour
   * avoir touché la ligne qui décrivait sa situation actuelle.
   *
   * Un réglage explicite prime sur une détection — c'est la règle que `getMarket`
   * applique déjà. Elle valait aussi ici.
   */
  const countryFor = (currency: Currency): CountryCode => {
    const stored = profile?.country as CountryCode | undefined;
    if (stored && MARKETS[stored]?.currency === currency) return stored;
    return countryForCurrency(currency, i18n.language);
  };

  const pickCurrency = (currency: Currency) => {
    hapticLight();
    applyCountry(countryFor(currency));
  };

  const applyCountry = async (country: CountryCode) => {
    hapticLight();
    if (!user?.id || country === profile?.country) {
      onClose();
      return;
    }
    setSavingCountry(true);
    try {
      await updateProfile(user.id, { country });

      // ── LES SEUILS REPARTENT SUR LE PLANCHER DU NOUVEAU MARCHÉ ────────────
      //
      // `min_hourly_rate` et `min_km_rate` sont des NOMBRES NUS : la colonne ne
      // porte pas de devise. Un chauffeur qui avait réglé 25 €/h et passe à la
      // livre se retrouvait avec « 25 £/h » — sa barre montait de 15 % sans
      // qu'il ait rien demandé, et rien ne le lui disait. Le kilométrique était
      // pire encore : 1,10 €/km s'affichait 1,77 £/mi, l'unité ayant changé en
      // plus de la monnaie.
      //
      // On ne peut pas convertir — l'app n'a pas de taux de change, et n'a
      // aucune raison d'en avoir. On repose donc les seuils sur le plancher du
      // marché d'arrivée, celui que l'onboarding aurait proposé. Le chauffeur
      // les retrouve dans Préférences et les rajuste s'il le souhaite : un
      // chiffre juste qu'il peut changer vaut mieux qu'un chiffre faux qu'il ne
      // voit pas.
      const floor = MARKETS[country].thresholds;
      await supabase
        .from('preferences')
        .update({ min_hourly_rate: floor.hourly, min_km_rate: floor.distance })
        .eq('id', user.id);

      await refreshProfile?.();
      // Le natif géocode avec ce pays : sans ce rappel, le prochain scan
      // chercherait encore l'adresse dans l'ancien.
      scannerService.setMarket?.(country, MARKETS[country].currency);
      // Et il verdicte avec ces seuils-là : la bulle et la Live Activity
      // garderaient sinon l'ancienne barre jusqu'au prochain focus du Dashboard.
      scannerService.setThresholds?.(floor.hourly, floor.distance);
    } catch (error: any) {
      // On ferme quand même : réessayer est un geste, pas une impasse.
      //
      // Mais on le SIGNALE. Un échec muet ici est indiscernable d'un succès :
      // la feuille se referme, le chauffeur croit avoir choisi la livre, et
      // toute l'app continue en euros. C'est exactement ce qui arrive si la
      // migration `20260915_profile_country.sql` n'a pas tourné — la colonne
      // manque, PostgREST refuse l'écriture, et rien ne le dit.
      Sentry.captureException(error, { tags: { flow: 'market_country' }, extra: { country } });
    } finally {
      setSavingCountry(false);
      onClose();
    }
  };

  // Le natif doit suivre : sans ça, les libellés de la Share Extension et de la
  // bulle Android restent dans l'ancienne langue.
  const pushToNative = (lang: string) => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      NativeModules.ScanBridge?.setAppLanguage?.(lang);
    }
  };

  const current = followsDevice ? null : i18n.language;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Le fond est tapable pour fermer, et reste sous la feuille : un
            Pressable enveloppant capterait aussi les taps sur les options. */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: anim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[styles.sheet, { paddingBottom: insets.bottom + 20, transform: [{ translateY }] }]}
        >
          <View style={styles.handle} />

          <View style={styles.headRow}>
            <View style={styles.iconBadge}>
              <Feather name="globe" size={20} color={colors.primary} />
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

          {step === 'lang' ? (
            <>
              <Text style={styles.title}>{t('preferences.language', 'Langue')}</Text>
              <Text style={styles.subtitle}>
                {t('preferences.languageSub', "Choisir la langue de l'app")}
              </Text>

              {/* Défilable depuis qu'il y a sept langues : à quatre lignes tout
                  tenait, à neuf la dernière sortait de l'écran sur un petit
                  téléphone — et une option qu'on ne voit pas n'existe pas. */}
              <ScrollView
                style={styles.optionsScroll}
                contentContainerStyle={styles.options}
                showsVerticalScrollIndicator={false}
              >
                <Option
                  label={t('preferences.languageDevice', "Langue de l'appareil")}
                  selected={current === null}
                  onPress={() => apply(null)}
                />
                {/* Chaque langue porte son propre nom : on ne cherche pas
                    « Néerlandais » quand on cherche « Nederlands ». */}
                {SUPPORTED.map(code => (
                  <Option
                    key={code}
                    label={LANGUAGE_NAMES[code] ?? code}
                    selected={current === code}
                    onPress={() => apply(code)}
                  />
                ))}
                <Option label={t('common.cancel', 'Annuler')} muted onPress={onClose} />
              </ScrollView>
            </>
          ) : step === 'market' ? (
            <>
              <Text style={styles.title}>{t('preferences.currency', 'Votre devise')}</Text>
              <Text style={styles.subtitle}>
                {t('preferences.currencySub', 'Celle que vous lirez sur chaque course.')}
              </Text>

              <ScrollView
                style={styles.optionsScroll}
                contentContainerStyle={styles.options}
                showsVerticalScrollIndicator={false}
              >
                {/* LES DEVISES, et rien d'autre. Un euro est un euro : entre la
                    France, la Belgique, l'Espagne et le Portugal, l'affichage,
                    l'unité de distance et le carburant saisi à la main sont
                    identiques. Demander le pays par-dessus, c'était poser une
                    question dont le chauffeur ne voyait pas l'objet. */}
                {currencies.map(([currency, countries]) => {
                  const m = MARKETS[countries[0]];
                  const iso = CURRENCY_CODE[currency];
                  return (
                    <Option
                      key={currency}
                      // « CHF CHF » n'aurait aucun sens : quand le symbole EST
                      // le code, on ne l'écrit qu'une fois.
                      label={m.symbol === iso ? iso : `${m.symbol}  ${iso}`}
                      // LE PAYS DÉDUIT, ÉCRIT. C'est lui qui part au géocodage,
                      // qui choisit la source du prix du carburant et qui pose le
                      // plancher de rentabilité — trois choses fausses d'un coup
                      // si la déduction tombe à côté. Elle était muette : un
                      // chauffeur de Porto au téléphone configuré en France
                      // obtenait « France » sans qu'aucun écran ne le lui dise,
                      // et ses adresses étaient géocodées à 1 500 km.
                      sub={countryName(countryFor(currency))}
                      selected={
                        !!profile?.country &&
                        MARKETS[profile.country as CountryCode]?.currency === currency
                      }
                      disabled={savingCountry}
                      onPress={() => pickCurrency(currency)}
                    />
                  );
                })}
                {/* Un tap pour qui voit le bon pays — l'immense majorité —, deux
                    pour les autres. Poser la question du pays à tout le monde
                    coûterait un écran de plus à chacun pour une erreur qui en
                    touche une minorité ; ne pas la poser du tout laissait cette
                    minorité dans le faux sans recours. */}
                <Option
                  label={t('preferences.countryChange', "Ce n'est pas mon pays ?")}
                  muted
                  disabled={savingCountry}
                  onPress={() => { hapticLight(); setStep('country'); }}
                />
                <Option label={t('common.cancel', 'Annuler')} muted onPress={onClose} />
              </ScrollView>
            </>
          ) : (
            <>
              <Text style={styles.title}>{t('preferences.country', 'Pays et devise')}</Text>
              <Text style={styles.subtitle}>
                {t(
                  'preferences.countrySub',
                  'Il fixe votre devise, vos cotisations et votre seuil de rentabilité.',
                )}
              </Text>

              <ScrollView
                style={styles.optionsScroll}
                contentContainerStyle={styles.options}
                showsVerticalScrollIndicator={false}
              >
                {/* LES SIX PAYS, et pas seulement ceux de la devise affichée.
                    Filtrer sur la monnaie supposerait que le chauffeur s'est au
                    moins trompé du bon côté — or celui qui arrive ici est
                    précisément celui dont la déduction est fausse. Le pays est
                    de toute façon la réponse complète : il porte la devise. */}
                {(Object.keys(MARKETS) as CountryCode[]).map(code => {
                  const m = MARKETS[code];
                  const iso = CURRENCY_CODE[m.currency];
                  return (
                    <Option
                      key={code}
                      label={countryName(code)}
                      sub={m.symbol === iso ? iso : `${m.symbol}  ${iso}`}
                      selected={profile?.country === code}
                      disabled={savingCountry}
                      onPress={() => applyCountry(code)}
                    />
                  );
                })}
                {/* Retour à la devise, pas fermeture : on est venu d'ici par un
                    détour, et un « Annuler » qui referme tout obligerait à
                    rouvrir la feuille et à repasser par la langue. */}
                <Option
                  label={t('common.back', 'Retour')}
                  muted
                  disabled={savingCountry}
                  onPress={() => { hapticLight(); setStep('market'); }}
                />
              </ScrollView>
            </>
          )}

        </Animated.View>
      </View>
    </Modal>
  );
};

const Option = ({
  label,
  sub,
  onPress,
  selected,
  muted,
  disabled,
}: {
  label: string;
  /** Seconde ligne, plus discrète — le pays derrière la devise. */
  sub?: string;
  onPress: () => void;
  selected?: boolean;
  muted?: boolean;
  disabled?: boolean;
}) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => [
      styles.option,
      selected && styles.optionSelected,
      pressed && styles.optionPressed,
    ]}
    accessibilityRole="button"
    accessibilityState={{ selected: !!selected }}
    accessibilityLabel={sub ? `${label}, ${sub}` : label}
  >
    <Text
      style={[
        styles.optionText,
        selected && styles.optionTextSelected,
        muted && styles.optionTextMuted,
      ]}
    >
      {label}
    </Text>
    {sub ? <Text style={styles.optionSub}>{sub}</Text> : null}
  </Pressable>
);

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.6)' },

  sheet: {
    backgroundColor: colors.surfaceLight,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xl,
    paddingTop: space.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.xs,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: space.lg,
  },

  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  iconBadge: {
    width: 46,
    height: 46,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  title: { color: colors.textMain, fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { color: colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: space.sm },

  // Plafonné à 60 % de la hauteur : au-delà, la feuille mangerait tout l'écran
  // et on ne verrait plus ce qu'elle recouvre.
  optionSub: {
    color: colors.textDimmed,
    fontSize: 12.5,
    marginTop: 2,
  },
  optionsScroll: { maxHeight: Dimensions.get('window').height * 0.6 },
  options: { marginTop: space.xl, gap: space.sm, paddingBottom: space.xs },
  // 56 px : la feuille se manipule d'une main, souvent en marchant.
  option: {
    height: 56,
    borderRadius: radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  optionSelected: { backgroundColor: colors.primary + '26' },
  // Enfoncement plutôt que changement de couleur : teinter au doigt brouillerait
  // l'état sélectionné, qui utilise déjà la teinte verte.
  optionPressed: { opacity: 0.7 },

  optionText: { color: colors.textMain, fontSize: 17, fontWeight: '600' },
  optionTextSelected: { color: colors.primary, fontWeight: '800' },
  optionTextMuted: { color: colors.textMuted },
});

export default LanguageSheet;
