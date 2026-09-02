import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Modal,
  Pressable,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { formatTimeAgo } from '../utils/dateUtils';
import { hapticSuccess, hapticError } from '../utils/haptics';
import {
  fetchTickets,
  createTicket,
  subcategoriesFor,
  SupportTicket,
  TicketStatus,
  TicketCategory,
  TICKET_CATEGORIES,
} from '../services/supportService';
import {
  getRecentFailures,
  SCAN_ERROR_CODES,
  ScanFailureReason,
  LastFailure,
} from '../services/scanFailureService';
import BrandLoader from '../components/BrandLoader';
import ListItemEntrance from '../components/ListItemEntrance';

const STATUS_META: Record<
  TicketStatus,
  { color: string; key: string; fallback: string }
> = {
  open: {
    color: '#FFB300',
    key: 'support.status.open',
    fallback: 'En attente',
  },
  answered: {
    color: colors.primary,
    key: 'support.status.answered',
    fallback: 'Répondu',
  },
  closed: {
    color: colors.textDimmed,
    key: 'support.status.closed',
    fallback: 'Fermé',
  },
};

const SupportTicketsScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [composeOpen, setComposeOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  // Catégorie puis sous-catégorie : la seconde ne s'affiche qu'une fois la
  // première choisie, et seulement si elle en a (`suggestion` / `other` n'en ont pas).
  const [category, setCategory] = useState<TicketCategory | null>(null);
  const [subcategory, setSubcategory] = useState<string | null>(null);

  // Les 3 dernières erreurs rencontrées : c'est l'utilisateur qui DÉSIGNE celle
  // qui motive son ticket, plutôt qu'on devine que la dernière est la bonne.
  const [recent, setRecent] = useState<LastFailure[]>([]);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Filtre de la liste — la file se lit par catégorie, comme sur les gros sites.
  const [filter, setFilter] = useState<TicketCategory | null>(null);

  const load = useCallback(async () => {
    try {
      setTickets(await fetchTickets());
    } catch {
      // silencieux : liste vide affichée
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Relu à chaque ouverture : une erreur peut survenir entre deux ouvertures.
  useEffect(() => {
    if (composeOpen) getRecentFailures().then(setRecent);
  }, [composeOpen]);

  const canSend = !!subject.trim() && !!message.trim() && !!category;

  const submit = async () => {
    if (!canSend || sending) return;
    setSending(true);
    try {
      const id = await createTicket(
        subject,
        message,
        category!,
        subcategory,
        errorCode,
      );
      hapticSuccess();
      setComposeOpen(false);
      setSubject('');
      setMessage('');
      setCategory(null);
      setSubcategory(null);
      setErrorCode(null);
      await load();
      navigation.navigate('SupportTicketDetail', {
        ticketId: id,
        subject: subject.trim(),
      });
    } catch {
      hapticError();
    } finally {
      setSending(false);
    }
  };

  const renderTicket = ({
    item,
    index,
  }: {
    item: SupportTicket;
    index: number;
  }) => {
    const meta = STATUS_META[item.status];
    return (
      <ListItemEntrance index={index}>
        <TouchableOpacity
          style={styles.ticketCard}
          activeOpacity={0.8}
          onPress={() =>
            navigation.navigate('SupportTicketDetail', {
              ticketId: item.id,
              subject: item.subject,
            })
          }
        >
          <View style={styles.ticketTop}>
            <Text style={styles.ticketSubject} numberOfLines={1}>
              {item.subject}
            </Text>
            <View
              style={[
                styles.statusBadge,
                {
                  backgroundColor: meta.color + '1F',
                  borderColor: meta.color + '40',
                },
              ]}
            >
              <Text style={[styles.statusText, { color: meta.color }]}>
                {t(meta.key, meta.fallback)}
              </Text>
            </View>
          </View>
          {item.category ? (
            <View style={styles.catBadge}>
              <Text style={styles.catBadgeTxt}>
                {(item.subcategory
                  ? t(`support.sub.${item.subcategory}`)
                  : t(`support.cat.${item.category}`)
                ).toUpperCase()}
                {item.error_code ? ` · ${item.error_code}` : ''}
              </Text>
            </View>
          ) : null}
          <View style={styles.ticketBottom}>
            <Text style={styles.ticketTime}>
              {formatTimeAgo(item.last_message_at, t)}
            </Text>
            <View style={styles.ticketBottomRight}>
              {item.priority ? (
                <View style={styles.prioBadge}>
                  <Feather name="zap" size={10} color={colors.primary} />
                  <Text style={styles.prioBadgeTxt}>
                    {t('support.priorityBadge', 'Prioritaire')}
                  </Text>
                </View>
              ) : null}
              <Feather name="chevron-right" size={16} color={colors.textDimmed} />
            </View>
          </View>
        </TouchableOpacity>
      </ListItemEntrance>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
        >
          <Feather name="chevron-left" size={30} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t('support.title', 'Mes tickets')}</Text>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <BrandLoader style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={filter ? tickets.filter(x => x.category === filter) : tickets}
          ListHeaderComponent={
            tickets.length >= 3 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterRow}
              >
                <TouchableOpacity
                  style={[styles.chip, !filter && styles.chipActive]}
                  onPress={() => setFilter(null)}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[styles.chipTxt, !filter && styles.chipTxtActive]}
                  >
                    {t('support.filterAll')}
                  </Text>
                </TouchableOpacity>
                {TICKET_CATEGORIES.filter(c =>
                  tickets.some(x => x.category === c),
                ).map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.chip, filter === c && styles.chipActive]}
                    onPress={() => setFilter(filter === c ? null : c)}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.chipTxt,
                        filter === c && styles.chipTxtActive,
                      ]}
                    >
                      {t(`support.cat.${c}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null
          }
          keyExtractor={i => i.id}
          renderItem={renderTicket}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <MaterialCommunityIcons
                  name="lifebuoy"
                  size={30}
                  color={colors.textDimmed}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {t('support.empty', "Aucun ticket pour l'instant")}
              </Text>
              <Text style={styles.emptyHint}>
                {t(
                  'support.emptyHint',
                  'Une question, un souci ? Ouvre un ticket, on te répond vite.',
                )}
              </Text>
            </View>
          }
        />
      )}

      {/* CTA nouveau ticket */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={() => setComposeOpen(true)}
          activeOpacity={0.85}
        >
          <Feather name="plus" size={18} color={colors.onPrimary} />
          <Text style={styles.newBtnText}>
            {t('support.newTicket', 'Nouveau ticket')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Compose modal */}
      <Modal
        visible={composeOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setComposeOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setComposeOpen(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ width: '100%' }}
          >
            <Pressable
              style={styles.modalCard}
              onPress={e => e.stopPropagation()}
            >
              <Text style={styles.modalTitle}>
                {t('support.newTicket', 'Nouveau ticket')}
              </Text>

              <ScrollView
                style={styles.composeScroll}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {/* 1. Catégorie — obligatoire : c'est elle qui trie la file. */}
                <Text style={styles.inputLabel}>
                  {t('support.categoryLabel')}
                </Text>
                <View style={styles.chipWrap}>
                  {TICKET_CATEGORIES.map(c => {
                    const active = category === c;
                    return (
                      <TouchableOpacity
                        key={c}
                        style={[styles.chip, active && styles.chipActive]}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => {
                          setCategory(c);
                          setSubcategory(null);
                        }}
                      >
                        <Text
                          style={[
                            styles.chipTxt,
                            active && styles.chipTxtActive,
                          ]}
                        >
                          {t(`support.cat.${c}`)}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* 2. Sous-catégorie — seulement si la catégorie en a. */}
                {category && subcategoriesFor(category).length > 0 ? (
                  <>
                    <Text style={styles.inputLabel}>
                      {t('support.subcategoryLabel')}
                    </Text>
                    <View style={styles.chipWrap}>
                      {subcategoriesFor(category).map(sc => {
                        const active = subcategory === sc;
                        return (
                          <TouchableOpacity
                            key={sc}
                            style={[styles.chip, active && styles.chipActive]}
                            activeOpacity={0.85}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            onPress={() => setSubcategory(active ? null : sc)}
                          >
                            <Text
                              style={[
                                styles.chipTxt,
                                active && styles.chipTxtActive,
                              ]}
                            >
                              {t(`support.sub.${sc}`)}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                ) : null}

                {/* 3. Code d'erreur — masqué s'il n'y a rien à rattacher. */}
                {recent.length > 0 ? (
                  <>
                    <Text style={styles.inputLabel}>
                      {t('support.errorLabel')}
                    </Text>
                    {recent.map(f => {
                      const code =
                        SCAN_ERROR_CODES[f.reason as ScanFailureReason];
                      if (!code) return null;
                      const active = errorCode === code;
                      return (
                        <TouchableOpacity
                          key={code + f.at}
                          style={[styles.errRow, active && styles.errRowActive]}
                          activeOpacity={0.85}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: active }}
                          onPress={() => setErrorCode(active ? null : code)}
                        >
                          <Feather
                            name={active ? 'check-circle' : 'circle'}
                            size={17}
                            color={
                              active ? colors.primary : 'rgba(255,255,255,0.18)'
                            }
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.errTitle}>
                              {t(`support.reason.${f.reason}`, code)}
                            </Text>
                            <Text style={styles.errMeta}>
                              {code} ·{' '}
                              {formatTimeAgo(new Date(f.at).toISOString(), t)}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </>
                ) : null}

                <Text style={styles.inputLabel}>
                  {t('support.subjectLabel', 'Sujet')}
                </Text>
                <TextInput
                  style={styles.input}
                  value={subject}
                  onChangeText={t => setSubject(t.slice(0, 140))}
                  placeholder={t(
                    'support.subjectPlaceholder',
                    'Ex : Problème de scan',
                  )}
                  placeholderTextColor={colors.textDimmed}
                  maxLength={140}
                />
                <Text style={styles.inputLabel}>
                  {t('support.messageLabel', 'Message')}
                </Text>
                <TextInput
                  style={[styles.input, styles.inputMultiline]}
                  value={message}
                  onChangeText={t => setMessage(t.slice(0, 4000))}
                  placeholder={t(
                    'support.messagePlaceholder',
                    'Décris ta demande en détail…',
                  )}
                  placeholderTextColor={colors.textDimmed}
                  multiline
                  textAlignVertical="top"
                />
              </ScrollView>

              <TouchableOpacity
                style={[styles.sendBtn, !canSend && { opacity: 0.5 }]}
                onPress={submit}
                disabled={sending || !canSend}
                activeOpacity={0.85}
              >
                {sending ? (
                  <ActivityIndicator color={colors.background} />
                ) : (
                  <>
                    <Feather name="send" size={16} color={colors.background} />
                    <Text style={styles.sendBtnText}>
                      {t('support.send', 'Envoyer')}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
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
    marginLeft: -10,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: { flex: 1, marginHorizontal: 14 },
  headerTitle: {
    marginRight: 12,
    flex: 1, color: colors.textMain, fontSize: 26, fontWeight: '800' },
  headerSub: { color: colors.textDimmed, fontSize: 12, marginTop: 2 },

  list: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
    flexGrow: 1,
  },
  ticketCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  ticketTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  ticketSubject: {
    color: colors.textMain,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusText: { fontSize: 11, fontWeight: '800' },
  ticketBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  ticketTime: { color: colors.textDimmed, fontSize: 12 },
  ticketBottomRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Pastille « Prioritaire » : la seule preuve visible que Premium change
  // quelque chose au support. Discrète — c'est une confirmation, pas une pub.
  prioBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: 'rgba(0,230,118,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.22)',
  },
  prioBadgeTxt: {
    color: colors.primary,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // Centré, mais dans le tiers HAUT plutôt qu'au milieu d'un écran vide.
  //
  // `justifyContent: center` combiné à `paddingTop: 80` poussait le bloc bien
  // en dessous du centre optique : le regard tombait sur du noir, et le message
  // arrivait au niveau du pouce. `flex-start` avec une marge mesurée le remonte
  // là où on lit.
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 56,
    gap: 10,
  },
  emptyIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.12)',
  },
  emptyTitle: { color: colors.textMuted, fontSize: 15, fontWeight: '700' },
  emptyHint: {
    color: colors.textDimmed,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 280,
  },

  // Plus d'air en bas qu'en haut : le bouton est le dernier élément de l'écran,
  // et l'encoche gérée par SafeAreaView ne suffit pas à le décoller
  // visuellement du bord.
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 18 },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.primary,
    paddingVertical: 16,
    // Capsule pleine, comme « Enregistrer » et le CTA du paywall.
    borderRadius: 999,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  newBtnText: {
    color: colors.onPrimary,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  modalTitle: {
    color: colors.textMain,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 16,
  },
  inputLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 7,
    marginTop: 4,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    color: colors.textMain,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  inputMultiline: { height: 120, marginBottom: 4 },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 15,
    borderRadius: 14,
    marginTop: 16,
  },
  // ── Formulaire : catégorie, sous-catégorie, code d'erreur ──────────────────
  // Le formulaire est devenu plus haut que l'écran sur les petits modèles :
  // il défile à l'intérieur de la carte, le bouton d'envoi reste en dehors pour
  // ne jamais sortir du champ de vision.
  composeScroll: { maxHeight: 380 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  chipActive: {
    backgroundColor: colors.primary + '1C',
    borderColor: colors.primary + '70',
  },
  chipTxt: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  chipTxtActive: { color: colors.primary },
  errRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderRadius: 12,
    marginBottom: 7,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  errRowActive: {
    backgroundColor: colors.primary + '12',
    borderColor: colors.primary + '55',
  },
  errTitle: { color: colors.textMain, fontSize: 13.5, fontWeight: '700' },
  errMeta: {
    color: colors.textDimmed,
    fontSize: 11.5,
    fontWeight: '500',
    marginTop: 2,
  },
  // Pastille de catégorie sur la carte d'un ticket + filtre de la liste.
  catBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    marginTop: 6,
  },
  catBadgeTxt: {
    color: colors.textMuted,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  filterRow: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    flexDirection: 'row',
    gap: 8,
  },
  sendBtnText: { color: colors.background, fontSize: 15, fontWeight: '800' },
});

export default SupportTicketsScreen;
