import React, { useEffect, useRef, useState } from 'react';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Linking,
  Alert,
  Platform,
  Image,
  Animated,
  NativeModules,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SafeGradient from '../components/SafeGradient';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import PlusBadge from '../components/PlusBadge';
import PlanBadge from '../components/PlanBadge';
import Toggle from '../components/Toggle';
import LanguageSheet from '../components/LanguageSheet';
import ManageSubscriptionSheet from '../components/ManageSubscriptionSheet';
import { colors } from '../theme/colors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';
import { registerPushToken, unregisterPushToken } from '../services/notificationService';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import AvatarView from '../components/AvatarView';
import { hapticLight } from '../utils/haptics';
import { fetchRides, effectiveFare } from '../services/ridesService';
import { getEffectivePlanTier } from '../services/subscriptionService';

/// Taille des icônes de menu. 22 et non 20 : posées à nu, sans tuile pour les
/// soutenir, deux pixels de plus suffisent à leur redonner du poids face à un
/// intitulé blanc en gras. Sur un glyphe en trait fin, c'est beaucoup.
const ICON_SIZE = 22;

/// Largeur de la bande lumineuse qui traverse la carte d'identité.
///
/// 90 : essayé à 160, la nappe couvrait un tiers de la carte et se lisait comme
/// deux reflets au lieu d'un. Assez large pour que le dégradé ait la place de
/// monter puis redescendre, assez étroite pour rester une seule bande.
const SHINE_WIDTH = 90;

/// Inclinaison de la bande, en degrés. ROTATION et non cisaillement.
///
/// Le cisaillement (`skewX`) a été essayé à −20, −30 puis −70° : le reflet
/// restait visuellement vertical. Un cisaillement ne fait pas pivoter la bande,
/// il décale chaque ligne horizontalement — plus l'angle monte, plus le dégradé
/// s'étire et se dilue, jusqu'à ne laisser qu'un lavis flou. La rotation, elle,
/// fait vraiment tourner la bande : l'inclinaison se voit, et l'épaisseur du
/// reflet reste constante quel que soit l'angle.
///
/// Positif = penché en `/` : la rotation est horaire, le haut part à droite.
/// 12° seulement : sur une nappe large, une forte inclinaison écrase les lobes
/// contre les bords de la carte et on ne voit plus qu'un coin éclairé.
const SHINE_ROTATE_DEG = 12;

/// Une bande tournée dépasse du cadre. Elle est donc dessinée bien plus haute
/// que la carte, et ce débord vertical se traduit en débord HORIZONTAL une fois
/// tournée : `sin(θ) × hauteur`. Sans l'intégrer à la course, le reflet
/// apparaîtrait ou disparaîtrait en plein milieu de la carte.
const shineOverhang = (height: number) =>
  Math.abs(Math.sin((SHINE_ROTATE_DEG * Math.PI) / 180)) * height;

type MenuItem = {
  icon: string;
  iconLib?: 'feather' | 'mc';
  title: string;
  sub?: string;
  /** Une ligne porte soit une navigation, soit un interrupteur, jamais les deux. */
  onPress?: () => void;
  badge?: string;
  accent?: boolean;
  /** Réservé à Strive Plus : affiche la pastille avant l'entrée dans l'écran. */
  plusLocked?: boolean;
  /** Valeur courante affichée à droite, avant le chevron. */
  value?: string;
  /** Interrupteur à droite : la ligne cesse alors d'être navigable. */
  toggle?: { value: boolean; onChange: (v: boolean) => void };
};

const ProfileScreen = () => {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();
  const tabBarHeight = useBottomTabBarHeight();
  const { profile, user, refreshProfile } = useAuth();
  const [isLogoutModalVisible, setIsLogoutModalVisible] = useState(false);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Palier EFFECTIF, comme les onze autres écrans. Le profil lisait
  // `subscription_tier` brut, donc sans contrôle d'expiration ni de période de
  // grâce : un abonnement expiré affichait encore la pastille Plus et masquait
  // la carte d'upsell, pendant que le Dashboard appliquait déjà le quota free.
  // L'écran qui parle de l'abonnement était le seul à en ignorer la validité.
  //
  // Ça retire aussi la règle `'pro' → premium` dupliquée ici : elle vit dans
  // `getPlanTier`, et c'est cette duplication qui avait laissé la dérive
  // s'installer.
  const tier = getEffectivePlanTier(profile);
  const isPlus = tier !== 'free';

  // Gains des 7 derniers jours : seules les courses acceptées comptent, une
  // course refusée n'a rapporté rien. `null` tant que la requête n'a pas
  // répondu — la carte se tait plutôt que d'annoncer 0 € à un chauffeur qui
  // vient d'en faire dix.
  const [weekEarnings, setWeekEarnings] = useState<number | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
        const rides = await fetchRides(user.id, since);
        const total = rides
          .filter(r => r.status === 'ACCEPTED')
          .reduce((sum, r) => sum + effectiveFare(r), 0);
        if (!cancelled) setWeekEarnings(total);
      } catch {
        // Écran de profil : un échec réseau ne doit pas le vider. La carte
        // reste simplement absente.
        if (!cancelled) setWeekEarnings(null);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Notifications : l'état affiché est la présence d'un jeton enregistré, pas un
  // drapeau local — c'est le jeton qui décide si le serveur peut joindre
  // l'appareil, donc c'est lui qui fait foi.
  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('@strive_fcm_token').then(v => setPushEnabled(!!v));
  }, []);

  const togglePush = async (next: boolean) => {
    setPushEnabled(next);
    hapticLight();
    if (!user?.id) return;
    try {
      if (next) await registerPushToken(user.id);
      else await unregisterPushToken(user.id);
      // `registerPushToken` sort sans rien faire si la permission système est
      // refusée : on relit donc le jeton plutôt que de croire l'interrupteur.
      const token = await AsyncStorage.getItem('@strive_fcm_token');
      setPushEnabled(!!token);
    } catch {
      setPushEnabled(!next);
    }
  };

  const [langSheetVisible, setLangSheetVisible] = useState(false);
  const [subSheetVisible, setSubSheetVisible] = useState(false);

  // ── Balayage lumineux de la carte d'identité ──────────────────────────────
  //
  // Largeur MESURÉE plutôt que déduite de `Dimensions` : la carte vit dans un
  // ScrollView avec ses propres marges, et une largeur devinée décalerait le
  // reflet — visible dès qu'il termine sa course avant ou après le bord.
  const [cardWidth, setCardWidth] = useState(0);
  const [cardHeight, setCardHeight] = useState(0);
  const shine = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (cardWidth === 0) return;
    // Une pause entre deux passages : en boucle continue, le reflet devient un
    // clignotement qu'on remarque au lieu d'un éclat qu'on aperçoit.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shine, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(3800),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [cardWidth, shine]);

  // Hauteur de la bande : le double de la carte. Une bande tournée dont la
  // hauteur égale celle de la carte laisserait deux coins vides aux extrémités
  // de sa course.
  const shineHeight = cardHeight * 2;
  // La course intègre le débord de l'inclinaison : le reflet entre et sort par
  // les bords, jamais au milieu de la carte.
  const overhang = shineOverhang(shineHeight);
  const shineTranslate = shine.interpolate({
    inputRange: [0, 1],
    outputRange: [-(SHINE_WIDTH + overhang), cardWidth + SHINE_WIDTH + overhang],
  });

  // La restauration est passée dans ManageSubscriptionSheet, qui en affiche le
  // résultat dans la feuille elle-même. Une alerte système chassait la feuille
  // au lieu de s'y inscrire, et imposait son style et ses boutons.

  // Le changement de langue est passé dans LanguageSheet, qui porte aussi le
  // choix « suivre l'appareil » — lequel efface la clé stockée plutôt que d'en
  // écrire une.

  const confirmLogout = async () => {
    setIsLogoutModalVisible(false);

    // Fermer la session de travail AVANT de déconnecter. La déconnexion ne
    // faisait que couper l'authentification, laissant derrière elle une session
    // ouverte et `is_online` à `true`.
    //
    // Ce n'est pas cosmétique : `online_sessions` sans `end_at` est compté comme
    // « en cours » et sa durée se calcule en `maintenant − start_at`
    // (DashboardScreen et AnalyticsScreen). Une session laissée ouverte gonfle
    // donc indéfiniment, et comme le taux horaire vaut gains ÷ heures, il
    // s'effondre vers zéro. Le chauffeur retrouve à la reconnexion un €/h faux
    // et une durée de service absurde.
    //
    // ORDRE OBLIGATOIRE : les deux écritures Supabase passent par la RLS, donc
    // exigent le jeton. Après `signOut()` elles seraient refusées en silence.
    if (user?.id) {
      try {
        const nowIso = new Date().toISOString();
        const { data: open } = await supabase
          .from('online_sessions')
          .select('id, start_at')
          .eq('user_id', user.id)
          .is('end_at', null);

        for (const s of open ?? []) {
          const elapsed = Math.max(
            0,
            Math.floor((Date.now() - new Date(s.start_at).getTime()) / 1000),
          );
          await supabase
            .from('online_sessions')
            .update({ end_at: nowIso, duration_seconds: elapsed })
            .eq('id', s.id);
        }

        await supabase.from('profiles').update({ is_online: false }).eq('id', user.id);
      } catch (e) {
        // Un échec ici ne doit pas retenir le chauffeur qui veut se déconnecter.
        // La session restera ouverte, ce qui est le comportement d'avant.
        __DEV__ && console.log('close session on logout failed:', e);
      }
    }

    // Le natif garde ses propres traces : le drapeau `sessionOnline` de l'App
    // Group commande le scan par raccourci, et la Live Activity survivrait à la
    // déconnexion — jusqu'à afficher les KPI de l'ancien chauffeur si un autre
    // compte se connecte sur le même appareil.
    try {
      const { ScanBridge } = NativeModules;
      ScanBridge?.setSessionOnline?.(false);
      if (Platform.OS === 'ios') ScanBridge?.stopLiveActivity?.();
    } catch {}

    try {
      await GoogleSignin.signOut();
    } catch (e) {
      __DEV__ && console.log('Google SignOut error:', e);
    }
    const { error } = await supabase.auth.signOut();
    if (error) __DEV__ && console.error(error.message);
  };

  const confirmDeleteAccount = async () => {
    if (deleteConfirmation.trim().toUpperCase() !== 'SUPPRIMER' &&
        deleteConfirmation.trim().toUpperCase() !== 'DELETE') {
      Alert.alert(
        t('profile.deleteModal.errorTitle', 'Confirmation requise'),
        t('profile.deleteModal.errorMessage', 'Tapez "SUPPRIMER" pour confirmer.'),
      );
      return;
    }
    setDeleting(true);
    try {
      // RGPD : purge l'avatar du Storage AVANT delete_account (après, plus de
      // session pour le faire ; un DELETE SQL sur storage.objects laisserait
      // le fichier orphelin côté S3). Best-effort : un échec ne bloque pas la
      // suppression du compte.
      if (user?.id) {
        try {
          const { data: files } = await supabase.storage.from('avatars').list(user.id);
          if (files && files.length > 0) {
            await supabase.storage
              .from('avatars')
              .remove(files.map(f => `${user.id}/${f.name}`));
          }
        } catch {}
      }
      const { error } = await supabase.rpc('delete_account');
      if (error) throw error;
      try { await GoogleSignin.signOut(); } catch {}
      await supabase.auth.signOut();
    } catch (e: any) {
      Alert.alert(
        t('profile.deleteModal.errorTitle', 'Erreur'),
        e?.message ?? t('profile.deleteModal.errorGeneric', 'Suppression impossible. Réessayez ou contactez le support.'),
      );
    } finally {
      setDeleting(false);
      setIsDeleteModalVisible(false);
      setDeleteConfirmation('');
    }
  };

  // Validation progressive : le bouton Supprimer ne s'active que si le mot exact
  // (SUPPRIMER ou DELETE) est saisi. L'input passe au vert quand c'est bon.
  const deleteWord = deleteConfirmation.trim().toUpperCase();
  const isDeleteConfirmValid = deleteWord === 'SUPPRIMER' || deleteWord === 'DELETE';

  const accountItems: MenuItem[] = [
    {
      icon: 'account-outline',
      iconLib: 'mc',
      title: t('profile.account'),
      sub: t('profile.accountSub'),
      onPress: () => navigation.navigate('AccountInfo'),
    },
    {
      icon: 'car-outline',
      iconLib: 'mc',
      title: t('profile.car'),
      sub: t('profile.carSub'),
      onPress: () => navigation.navigate('CarSettings'),
      // CarSettingsScreen couvre tout l'écran d'un calque qui renvoie au paywall
      // pour un compte free : sans cette pastille, le tap se solde par un
      // renvoi brutal, sans que rien n'ait annoncé la restriction.
      plusLocked: !isPlus,
    },
    {
      icon: 'tune-vertical',
      iconLib: 'mc',
      title: t('preferences.title'),
      sub: t('preferences.subtitle'),
      onPress: () => navigation.navigate('Preferences'),
    },
    // « Gérer mon abonnement » a rejoint la section Abonnement, où il figurait
    // en double.
  ];

  const resourceItems: MenuItem[] = [
    {
      icon: 'school-outline',
      iconLib: 'mc',
      title: t('profile.tutorial'),
      sub: t('profile.tutorialSub'),
      onPress: () => navigation.navigate('Tutorial'),
      badge: 'NEW',
      accent: true,
    },
    {
      icon: 'help-circle-outline',
      iconLib: 'mc',
      title: t('profile.help'),
      sub: t('profile.helpSub'),
      onPress: () => navigation.navigate('Help'),
    },
    {
      icon: 'lifebuoy',
      iconLib: 'mc',
      title: t('support.title', 'Mes tickets'),
      sub: t('support.menuSub', 'Contacter le support, suivre tes demandes'),
      onPress: () => navigation.navigate('SupportTickets'),
    },
  ];

  const renderIcon = (item: MenuItem) => {
    // Gris de la même valeur que le chevron : l'icône et la flèche encadrent le
    // libellé sans lui disputer l'attention. C'est ce que fait le build blanc —
    // icônes nues, gris moyen — transposé en sombre : là-bas gris foncé sur
    // blanc, ici gris clair sur noir, même écart de contraste.
    //
    // Seule la ligne d'accent passe au vert. Une couleur qui ne sert qu'une fois
    // par écran désigne ; répétée sur quinze lignes, elle ne désigne plus rien.
    //
    // Gris ÉCLAIRCI (`textMain` à 70 %) et non `textMuted` : sur blanc, un trait
    // fin gris moyen tient parce que le fond réfléchit ; sur `#15241C` il
    // s'efface, surtout à côté d'un intitulé blanc en gras. Le contraste brut
    // était pourtant correct — c'est le rapport à son voisin qui comptait.
    const color = item.accent ? colors.primary : 'rgba(255,255,255,0.7)';
    if (item.iconLib === 'feather') {
      return <Feather name={item.icon as any} size={ICON_SIZE} color={color} />;
    }
    return <MaterialCommunityIcons name={item.icon as any} size={ICON_SIZE} color={color} />;
  };

  const renderMenuGroup = (items: MenuItem[]) => (
    <View style={styles.menuGroup}>
      {items.map((item, i) => (
        <TouchableOpacity
          key={i}
          style={[styles.menuRow, i < items.length - 1 && styles.menuRowDivider]}
          onPress={item.onPress}
          // Une ligne à interrupteur n'est pas tapable dans son ensemble : le
          // doigt qui vise le libellé ne doit pas basculer le réglage.
          disabled={!item.onPress}
          activeOpacity={0.7}
          accessibilityRole={item.toggle ? 'switch' : 'button'}
          accessibilityLabel={item.title}
        >
          {/* Dégradé plutôt qu'aplat. Quinze tuiles rigoureusement identiques
              alignées en colonne se lisent comme une trame, pas comme des
              repères : c'est plat, et l'œil glisse. Le dégradé diagonal donne
              du volume à chacune sans toucher à la saturation d'ensemble —
              c'est le relief qui manquait, pas la couleur.

              La variante « accent » n'existe plus : à 10 % d'opacité elle
              rendait la ligne mise en avant PLUS pâle que les autres. */}
          <View style={styles.menuIconWrap}>{renderIcon(item)}</View>
          <View style={styles.menuText}>
            <Text style={[styles.menuTitle, item.accent && { color: colors.textMain }]} numberOfLines={1}>
              {item.title}
            </Text>
            {/* Sous-titres retirés : ils paraphrasaient l'intitulé de la ligne
                (« Préférences » / « Paramètres d'acceptation des courses ») et
                doublaient la hauteur de chaque entrée pour rien. Le champ `sub`
                reste dans le type, les libellés existent toujours en traduction
                — seul l'affichage est supprimé. */}
          </View>
          {item.plusLocked && <PlusBadge style={styles.menuPlusBadge} />}
          {item.value ? <Text style={styles.menuValue}>{item.value}</Text> : null}
          {item.toggle ? (
            <Toggle
              value={item.toggle.value}
              onValueChange={item.toggle.onChange}
              accessibilityLabel={item.title}
            />
          ) : item.badge ? (
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>{item.badge}</Text>
            </View>
          ) : (
            <Feather name="chevron-right" size={18} color={colors.textDimmed} />
          )}
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('profile.title')}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── PROFILE CARD ── */}
        <SafeGradient
          colors={['#0F2D1F', '#0A150E']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.profileCard}
          onLayout={e => {
            setCardWidth(e.nativeEvent.layout.width);
            setCardHeight(e.nativeEvent.layout.height);
          }}
        >

          <View style={styles.profileContent}>
            {isPlus && <View style={styles.plusGlow} />}
            <View style={styles.profileShimmer} />

            <View style={styles.avatarContainer}>
              <AvatarView
                avatarId="generic"
                size={84}
                borderColor={colors.primary}
              />
            </View>

            <Text style={styles.userName} numberOfLines={1}>
              {profile?.first_name
                ? `${profile.first_name} ${profile.last_name ?? ''}`.trim()
                : t('dashboard.greetingDefault')}
            </Text>

            {user?.email ? (
              <Text style={styles.userEmail} numberOfLines={1}>{user.email}</Text>
            ) : null}

            {isPlus ? (
              <PlanBadge style={styles.tierBadgeSpacing} />
            ) : (
              <TouchableOpacity
                style={styles.upgradeBtnWrap}
                onPress={() => navigation.navigate('SubscriptionScreen')}
                activeOpacity={0.85}
              >
                <SafeGradient
                  colors={['#A4FF6B', '#00FF8C', colors.primary]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.upgradeBtn}
                >
                  <Image
                    source={require('../assets/strive-logo.png')}
                    style={styles.upgradeBtnLogo}
                  />
                  <Text style={styles.upgradeBtnText}>{t('profile.upgradeLink')}</Text>
                </SafeGradient>
              </TouchableOpacity>
            )}
          </View>

          {/* Reflet qui traverse la carte. Incliné, sinon on ne lit qu'une barre
              verticale qui glisse ; l'inclinaison est ce qui le fait passer pour
              une lumière plutôt que pour un élément d'interface.
              `pointerEvents="none"` : il couvre le bouton Plus, et rien de
              décoratif ne doit intercepter un tap. */}
          {cardWidth > 0 && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.shine,
                {
                  height: shineHeight,
                  top: -(shineHeight - cardHeight) / 2,
                  transform: [{ translateX: shineTranslate }],
                },
              ]}
            >
              {/* La rotation est portée par une vue INTERNE et statique. Dans le
                  même tableau de transformations que le `translateX` animé, le
                  pilote natif refuse la propriété et retombe en JS — le balayage
                  saccade dès que la liste défile. */}
              <View style={styles.shineSkew}>
                <SafeGradient
                  // UN SEUL lobe. La version à deux lobes séparés d'un creux
                  // avait été essayée pour imiter un satiné : à l'écran elle se
                  // lisait comme deux reflets distincts qui traversent ensemble,
                  // pas comme une surface polie.
                  colors={[
                    'rgba(255,255,255,0)',
                    'rgba(255,255,255,0.10)',
                    'rgba(255,255,255,0)',
                  ]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={StyleSheet.absoluteFill}
                />
              </View>
            </Animated.View>
          )}
        </SafeGradient>

        {/* Gains de la semaine, posés entre l'identité et les réglages : c'est
            le seul chiffre que le chauffeur vient chercher ici, et il donne au
            profil une raison d'être ouvert autrement que pour se déconnecter. */}
        {weekEarnings !== null && (
          <View style={styles.earnCard}>
            <View style={styles.earnTexts}>
              <Text style={styles.earnLabel}>{t('profile.weekEarnings')}</Text>
              <View style={styles.earnAmountRow}>
                <Text style={styles.earnWhole}>
                  {Math.floor(weekEarnings).toLocaleString('fr-FR')}
                </Text>
                {/* Les centimes en retrait : ils comptent, mais ce sont les
                    euros qui se lisent d'un coup d'œil. */}
                <Text style={styles.earnCents}>
                  ,{Math.round((weekEarnings % 1) * 100).toString().padStart(2, '0')} €
                </Text>
              </View>
            </View>
            <View style={styles.earnBadge}>
              <Feather name="trending-up" size={20} color={colors.primary} />
            </View>
          </View>
        )}

        {/* ── ACCOUNT SECTION ── */}
        <Text style={styles.sectionTitle}>{t('profile.general')}</Text>
        {renderMenuGroup(accountItems)}

        {/* ── UPGRADE CTA (free only) ── */}
        {!isPlus && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => navigation.navigate('SubscriptionScreen')}
            style={styles.profileUpgradeCard}
          >
            <SafeGradient
              colors={['#0A2418', '#0E3020', '#122E1E']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.profileUpgradeGradient}
            >
              <View style={styles.profileUpgradeGlow} />
              <View style={styles.profileUpgradeRow}>
                {/* Logo Strive plutôt qu'une couronne : c'est un passage à
                    Strive Plus, pas à un rang. La marque dit ce qu'on achète,
                    la couronne ne disait que « premium » en générique. */}
                <Image
                  source={require('../assets/strive-logo.png')}
                  style={styles.profileUpgradeLogo}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.profileUpgradeTitle}>{t('profile.upgradeCardTitle')}</Text>
                  <Text style={styles.profileUpgradeSub}>{t('profile.upgradeCardSub')}</Text>
                </View>
                <Feather name="arrow-right" size={18} color={colors.primary} />
              </View>
            </SafeGradient>
          </TouchableOpacity>
        )}

        {/* Les deux boutons drapeau laissent place à une ligne de réglage
            classique, avec la langue courante affichée à droite. Deux langues
            seulement : le tap bascule directement plutôt que d'ouvrir une liste
            de deux entrées. */}
        <Text style={[styles.sectionTitle, { marginTop: 22 }]}>{t('profile.settings', 'Réglages')}</Text>
        {renderMenuGroup([
          {
            icon: 'translate',
            iconLib: 'mc',
            title: t('preferences.language', 'Langue'),
            value: i18n.language === 'fr' ? 'Français' : 'English',
            onPress: () => setLangSheetVisible(true),
          },
          {
            icon: 'bell-outline',
            iconLib: 'mc',
            title: t('preferences.push', 'Notifications push'),
            toggle: { value: pushEnabled, onChange: togglePush },
          },
        ])}

        {/* Abonnement : « Passer à Strive Plus » n'apparaît qu'aux comptes
            gratuits, « Gérer » qu'aux abonnés — proposer les deux ferait douter
            de son propre statut. « Restaurer » reste dans les deux cas : c'est
            une exigence de l'App Store, et c'est aussi le recours d'un abonné
            que l'app croit gratuit. */}
        <Text style={[styles.sectionTitle, { marginTop: 22 }]}>{t('profile.subscription', 'Abonnement')}</Text>
        {renderMenuGroup([
          ...(isPlus ? [{
            icon: 'crown-outline',
            iconLib: 'mc' as const,
            title: t('subscription.manage', 'Gérer mon abonnement'),
            onPress: () => setSubSheetVisible(true),
          }] : [{
            icon: 'crown-outline',
            iconLib: 'mc' as const,
            title: t('profile.upgradeLink', 'Passer à Strive Plus'),
            accent: true,
            onPress: () => navigation.navigate('SubscriptionScreen'),
          }]),
          {
            icon: 'restore',
            iconLib: 'mc' as const,
            title: t('subscription.restore', 'Restaurer les achats'),
            onPress: () => setSubSheetVisible(true),
          },
        ])}

        {/* ── SUPPORT ── */}
        <Text style={[styles.sectionTitle, { marginTop: 22 }]}>{t('profile.supportSection', 'Support')}</Text>
        {renderMenuGroup(resourceItems)}

        {/* Légal : deux liens qu'Apple exige d'atteindre depuis l'app, et qui
            étaient relégués en minuscules tout en bas de l'écran. */}
        <Text style={[styles.sectionTitle, { marginTop: 22 }]}>{t('profile.legal', 'Légal')}</Text>
        {renderMenuGroup([
          {
            icon: 'file-document-outline',
            iconLib: 'mc',
            title: t('profile.terms', 'Conditions d\'utilisation'),
            onPress: () => Linking.openURL('https://striveapp.fr/terms'),
          },
          {
            icon: 'shield-lock-outline',
            iconLib: 'mc',
            title: t('profile.privacy', 'Politique de confidentialité'),
            onPress: () => Linking.openURL('https://striveapp.fr/privacy'),
          },
        ])}

        <Text style={[styles.sectionTitle, styles.dangerSectionTitle, { marginTop: 22 }]}>
          {t('profile.session', 'Session')}
        </Text>

        <View style={styles.dangerGroup}>
          <TouchableOpacity
            style={[styles.menuRow, styles.menuRowDivider]}
            onPress={() => setIsLogoutModalVisible(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('profile.logout')}
          >
            <View style={styles.menuIconWrapDanger}>
              <Feather name="log-out" size={20} color={colors.danger} />
            </View>
            <View style={styles.menuText}>
              <Text style={[styles.menuTitle, { color: colors.danger }]}>{t('profile.logout')}</Text>
              <Text style={styles.menuSub}>{t('profile.logoutModal.message')}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.textDimmed} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuRow}
            onPress={() => setIsDeleteModalVisible(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('profile.deleteAccount', 'Supprimer mon compte')}
          >
            <View style={styles.menuIconWrapDanger}>
              <Feather name="trash-2" size={20} color={colors.danger} />
            </View>
            <View style={styles.menuText}>
              <Text style={[styles.menuTitle, { color: colors.danger }]}>
                {t('profile.deleteAccount', 'Supprimer mon compte')}
              </Text>
              <Text style={styles.menuSub}>
                {t('profile.deleteAccountSub', 'Action irréversible')}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.textDimmed} />
          </TouchableOpacity>
        </View>

        {/* Les liens légaux ont rejoint leur propre section, et la version n'est
            plus affichée ici. Elle reste jointe automatiquement aux demandes de
            support (`supportService`, `HelpScreen`) et aux traces de scan : le
            besoin réel — savoir sur quel build tourne un chauffeur qui signale
            un problème — est couvert sans occuper le pied de page. */}
      </ScrollView>

      <LanguageSheet visible={langSheetVisible} onClose={() => setLangSheetVisible(false)} />

      <ManageSubscriptionSheet
        visible={subSheetVisible}
        onClose={() => setSubSheetVisible(false)}
        isSubscribed={isPlus}
        planLabel={isPlus ? t('tier.plusName', 'Plus') : t('tier.freeBadge', 'Free')}
        userId={user?.id}
        onRestored={() => refreshProfile?.()}
      />

      {/* ── LOGOUT MODAL ── */}
      <Modal
        animationType="fade"
        transparent
        visible={isLogoutModalVisible}
        onRequestClose={() => setIsLogoutModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <Feather name="log-out" size={26} color={colors.danger} />
            </View>
            <Text style={styles.modalTitle}>{t('profile.logoutModal.title')}</Text>
            <Text style={styles.modalMessage}>{t('profile.logoutModal.message')}</Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => setIsLogoutModalVisible(false)}
              >
                <Text style={styles.modalBtnCancelText}>{t('profile.logoutModal.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnConfirm]}
                onPress={confirmLogout}
              >
                <Text style={styles.modalBtnConfirmText}>{t('profile.logoutModal.confirm')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── DELETE ACCOUNT MODAL ── */}
      <Modal
        animationType="fade"
        transparent
        visible={isDeleteModalVisible}
        onRequestClose={() => { setIsDeleteModalVisible(false); setDeleteConfirmation(''); }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={[styles.modalIconWrap, { backgroundColor: 'rgba(239,68,68,0.12)' }]}>
              <Feather name="alert-triangle" size={26} color={colors.danger} />
            </View>
            <Text style={styles.modalTitle}>{t('profile.deleteModal.title', 'Supprimer le compte ?')}</Text>
            <Text style={styles.modalMessage}>
              {t('profile.deleteModal.message', 'Action irréversible : compte, préférences et historique des courses seront définitivement supprimés.')}
            </Text>
            <TextInput
              style={[styles.deleteInput, isDeleteConfirmValid && styles.deleteInputValid]}
              placeholder={t('profile.deleteModal.placeholder', 'Tapez SUPPRIMER')}
              placeholderTextColor={colors.textDimmed}
              value={deleteConfirmation}
              onChangeText={setDeleteConfirmation}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => { if (isDeleteConfirmValid && !deleting) confirmDeleteAccount(); }}
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnCancel]}
                onPress={() => { setIsDeleteModalVisible(false); setDeleteConfirmation(''); }}
                disabled={deleting}
              >
                <Text style={styles.modalBtnCancelText}>{t('profile.logoutModal.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnConfirm, (deleting || !isDeleteConfirmValid) && styles.modalBtnConfirmDisabled]}
                onPress={confirmDeleteAccount}
                disabled={deleting || !isDeleteConfirmValid}
                accessibilityState={{ disabled: deleting || !isDeleteConfirmValid }}
              >
                <Text style={styles.modalBtnConfirmText}>
                  {deleting ? '…' : t('profile.deleteModal.confirm', 'Supprimer')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  headerTitle: { color: colors.textMain, fontSize: 28, fontWeight: '900' },

  scrollContent: { paddingHorizontal: 20 },

  // Profile card
  profileCard: {
    borderRadius: 24,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.18)',
    overflow: 'hidden',
  },
  profileContent: {
    padding: 24,
    alignItems: 'center',
  },
  profileShimmer: {
    position: 'absolute',
    top: 0,
    left: 24,
    right: 24,
    height: 1,
    backgroundColor: 'rgba(0,230,118,0.32)',
  },
  // Bande du reflet. `height` et `top` sont calculés au rendu depuis la hauteur
  // mesurée de la carte — ils ne peuvent pas vivre dans une feuille statique.
  shine: {
    position: 'absolute',
    left: 0,
    width: SHINE_WIDTH,
  },
  shineSkew: {
    flex: 1,
    transform: [{ rotate: `${SHINE_ROTATE_DEG}deg` }],
  },
  plusGlow: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(0,230,118,0.08)',
  },
  avatarContainer: { marginBottom: 14 },
  userName: {
    color: colors.textMain,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  userEmail: {
    color: colors.textDimmed,
    fontSize: 12,
    marginTop: 4,
    marginBottom: 14,
  },
  tierBadgeSpacing: { marginTop: 4 },
  tierBadgePlusText: {
    color: colors.background,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },
  upgradeBtnWrap: {
    marginTop: 8,
    borderRadius: 22, overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#00FF8C', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 10 },
      android: { elevation: 8 },
    }),
  },
  upgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 22,
  },
  upgradeBtnText: { color: '#062318', fontSize: 13, fontWeight: '900', letterSpacing: 0.3 },

  // Upgrade CTA card
  profileUpgradeCard: {
    marginTop: 18, marginBottom: 18, borderRadius: 18, overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#00E676', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 14 },
      android: { elevation: 8 },
    }),
  },
  profileUpgradeGradient: {
    borderRadius: 18, padding: 18,
    borderWidth: 1.5, borderColor: 'rgba(0,230,118,0.25)',
    overflow: 'hidden',
  },
  profileUpgradeGlow: {
    position: 'absolute', top: -20, right: -20,
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: 'rgba(0,230,118,0.08)',
  },
  profileUpgradeRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  // Le halo vert est conservé : il détachait la tuile du dégradé sombre de la
  // carte, et le logo en a autant besoin que la couronne.
  profileUpgradeLogo: {
    width: 42, height: 42, borderRadius: 14,
    ...Platform.select({
      ios: { shadowColor: '#00FF8C', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.6, shadowRadius: 8 },
      android: { elevation: 6 },
    }),
  },
  upgradeBtnLogo: { width: 16, height: 16, borderRadius: 8 },
  profileUpgradeTitle: { color: colors.textMain, fontSize: 15, fontWeight: '900', letterSpacing: -0.2 },
  profileUpgradeSub: { color: colors.textMuted, fontSize: 12, marginTop: 3, lineHeight: 16 },

  // Section title
  earnCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 20,
    paddingHorizontal: 20,
    // Mêmes fond, rayon et bordure que les groupes de menu : la carte était en
    // blanc translucide, donc d'un gris légèrement différent de tout ce qui
    // l'entoure — l'écart se voyait sans rien signifier.
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    marginBottom: 22,
  },
  earnTexts: { flex: 1 },
  earnLabel: {
    color: colors.textDimmed,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  earnAmountRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 6 },
  earnWhole: {
    color: colors.textMain,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -1.2,
  },
  earnCents: {
    color: colors.textMuted,
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  earnBadge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary + '1F',
  },

  sectionTitle: {
    color: colors.textDimmed,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 10,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  dangerSectionTitle: { color: colors.danger, opacity: 0.7 },

  // Menu group (iOS settings-like card)
  menuGroup: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  dangerGroup: {
    backgroundColor: 'rgba(255,77,77,0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,77,77,0.18)',
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  menuRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  // Tuiles en aplat plein, comme la référence : le gris à 4 % d'opacité les
  // rendait presque invisibles, et une liste de quinze lignes sans repère
  // coloré se parcourt uniquement au texte.
  // Le dégradé va de `primary` (haut gauche) à `primarySoft` (bas droite) : le
  // vert vif n'occupe donc qu'un coin au lieu de toute la surface, ce qui laisse
  // la colonne calme tout en donnant du relief. Un aplat de `primary` sur les
  // quinze tuiles refaisait le mur fluo qui passait devant les intitulés.
  //
  // La lueur verte, discrète et diffuse, détache la tuile du fond de carte au
  // lieu de la laisser collée dessus. C'est elle qui fait la différence entre
  // « posé » et « imprimé ».
  // Aucun fond : l'icône se pose directement sur la ligne. Le conteneur ne sert
  // plus qu'à réserver une largeur constante pour que la colonne d'icônes reste
  // alignée quelle que soit la forme du glyphe.
  menuIconWrap: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuIconWrapDanger: {
    width: 38,
    height: 38,
    backgroundColor: 'rgba(255,77,77,0.1)',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  menuText: { flex: 1 },
  // 15/700, comme partout ailleurs dans l'app : `toggleTitle` de Preferences est
  // en 14/700, les autres titres de ligne en 15/700 ou 800. Les métriques des
  // Réglages iOS (17 pt, graisse normale) avaient été essayées et écartées —
  // elles faisaient du Profil le seul écran hors convention.
  //
  // Aucune `fontFamily` n'est posée nulle part dans le projet : le rendu est
  // déjà San Francisco sur iOS et Roboto sur Android.
  menuTitle: { color: colors.textMain, fontSize: 15, fontWeight: '700', marginBottom: 2 },
  menuSub: { color: colors.textDimmed, fontSize: 12, fontWeight: '500' },
  menuValue: { color: colors.primary, fontSize: 14, fontWeight: '700', marginRight: 6 },
  menuPlusBadge: { marginRight: 8 },
  newBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  newBadgeText: { color: colors.background, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },

  // Language
  langRow: { flexDirection: 'row', gap: 10 },
  langBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  langBtnActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(0,230,118,0.08)',
  },
  langFlag: { fontSize: 18 },
  langBtnText: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  langBtnTextActive: { color: colors.textMain },

  // Footer
  legalLinksRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 28,
    marginBottom: 8,
  },
  legalLink: { color: colors.textDimmed, fontSize: 11, textDecorationLine: 'underline' },
  legalSep: { color: colors.textDimmed, fontSize: 11 },

  deleteInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.textMain,
    backgroundColor: 'rgba(239,68,68,0.05)',
    marginBottom: 16,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1,
  },
  deleteInputValid: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(0,230,118,0.06)',
    color: colors.primary,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: colors.surface,
    width: '100%',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 16,
  },
  modalIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(255,77,77,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { color: colors.textMain, fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  modalMessage: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
  },
  modalBtns: { flexDirection: 'row', gap: 12, width: '100%' },
  modalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  modalBtnCancel: { backgroundColor: colors.surfaceLight },
  modalBtnConfirm: { backgroundColor: colors.danger },
  modalBtnConfirmDisabled: { opacity: 0.4 },
  modalBtnCancelText: { color: colors.textMain, fontSize: 14, fontWeight: '600' },
  modalBtnConfirmText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
});

export default ProfileScreen;
