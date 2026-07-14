import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Modal, Pressable,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
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
import { fetchTickets, createTicket, SupportTicket, TicketStatus } from '../services/supportService';
import BrandLoader from '../components/BrandLoader';

const STATUS_META: Record<TicketStatus, { color: string; key: string; fallback: string }> = {
  open:     { color: '#FFB300', key: 'support.status.open',     fallback: 'En attente' },
  answered: { color: colors.primary, key: 'support.status.answered', fallback: 'Répondu' },
  closed:   { color: colors.textDimmed, key: 'support.status.closed', fallback: 'Fermé' },
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

  const load = useCallback(async () => {
    try {
      setTickets(await fetchTickets());
    } catch {
      // silencieux : liste vide affichée
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    if (!subject.trim() || !message.trim() || sending) return;
    setSending(true);
    try {
      const id = await createTicket(subject, message);
      hapticSuccess();
      setComposeOpen(false);
      setSubject(''); setMessage('');
      await load();
      navigation.navigate('SupportTicketDetail', { ticketId: id, subject: subject.trim() });
    } catch {
      hapticError();
    } finally {
      setSending(false);
    }
  };

  const renderTicket = ({ item }: { item: SupportTicket }) => {
    const meta = STATUS_META[item.status];
    return (
      <TouchableOpacity
        style={styles.ticketCard}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('SupportTicketDetail', { ticketId: item.id, subject: item.subject })}
      >
        <View style={styles.ticketTop}>
          <Text style={styles.ticketSubject} numberOfLines={1}>{item.subject}</Text>
          <View style={[styles.statusBadge, { backgroundColor: meta.color + '1F', borderColor: meta.color + '40' }]}>
            <Text style={[styles.statusText, { color: meta.color }]}>{t(meta.key, meta.fallback)}</Text>
          </View>
        </View>
        <View style={styles.ticketBottom}>
          <Text style={styles.ticketTime}>{formatTimeAgo(item.last_message_at, t)}</Text>
          <Feather name="chevron-right" size={16} color={colors.textDimmed} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.textMain} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{t('support.title', 'Mes tickets')}</Text>
          <Text style={styles.headerSub}>{t('support.subtitle', 'Support Strive')}</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <BrandLoader style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={(i) => i.id}
          renderItem={renderTicket}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <MaterialCommunityIcons name="lifebuoy" size={30} color={colors.textDimmed} />
              </View>
              <Text style={styles.emptyTitle}>{t('support.empty', 'Aucun ticket pour l\'instant')}</Text>
              <Text style={styles.emptyHint}>{t('support.emptyHint', 'Une question, un souci ? Ouvre un ticket, on te répond vite.')}</Text>
            </View>
          }
        />
      )}

      {/* CTA nouveau ticket */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.newBtn} onPress={() => setComposeOpen(true)} activeOpacity={0.85}>
          <Feather name="plus" size={18} color={colors.background} />
          <Text style={styles.newBtnText}>{t('support.newTicket', 'Nouveau ticket')}</Text>
        </TouchableOpacity>
      </View>

      {/* Compose modal */}
      <Modal visible={composeOpen} transparent animationType="fade" onRequestClose={() => setComposeOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setComposeOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
            <Pressable style={styles.modalCard} onPress={e => e.stopPropagation()}>
              <Text style={styles.modalTitle}>{t('support.newTicket', 'Nouveau ticket')}</Text>
              <Text style={styles.inputLabel}>{t('support.subjectLabel', 'Sujet')}</Text>
              <TextInput
                style={styles.input}
                value={subject}
                onChangeText={t => setSubject(t.slice(0, 140))}
                placeholder={t('support.subjectPlaceholder', 'Ex : Problème de scan')}
                placeholderTextColor={colors.textDimmed}
                maxLength={140}
              />
              <Text style={styles.inputLabel}>{t('support.messageLabel', 'Message')}</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={message}
                onChangeText={t => setMessage(t.slice(0, 4000))}
                placeholder={t('support.messagePlaceholder', 'Décris ta demande en détail…')}
                placeholderTextColor={colors.textDimmed}
                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!subject.trim() || !message.trim()) && { opacity: 0.5 }]}
                onPress={submit}
                disabled={sending || !subject.trim() || !message.trim()}
                activeOpacity={0.85}
              >
                {sending ? <ActivityIndicator color={colors.background} /> : (
                  <>
                    <Feather name="send" size={16} color={colors.background} />
                    <Text style={styles.sendBtnText}>{t('support.send', 'Envoyer')}</Text>
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: colors.surface,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  headerCenter: { flex: 1, marginHorizontal: 14 },
  headerTitle: { color: colors.textMain, fontSize: 17, fontWeight: '800' },
  headerSub: { color: colors.textDimmed, fontSize: 12, marginTop: 2 },

  list: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20, flexGrow: 1 },
  ticketCard: {
    backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  ticketTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  ticketSubject: { color: colors.textMain, fontSize: 15, fontWeight: '700', flex: 1 },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  statusText: { fontSize: 11, fontWeight: '800' },
  ticketBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  ticketTime: { color: colors.textDimmed, fontSize: 12 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 10 },
  emptyIcon: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: colors.surface,
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.12)',
  },
  emptyTitle: { color: colors.textMuted, fontSize: 15, fontWeight: '700' },
  emptyHint: { color: colors.textDimmed, fontSize: 13, textAlign: 'center', lineHeight: 19, maxWidth: 280 },

  footer: { paddingHorizontal: 20, paddingVertical: 14 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 16,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 6,
  },
  newBtnText: { color: colors.background, fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalCard: {
    backgroundColor: colors.surface, borderRadius: 22, padding: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  modalTitle: { color: colors.textMain, fontSize: 18, fontWeight: '800', marginBottom: 16 },
  inputLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 7, marginTop: 4 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)', color: colors.textMain,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  inputMultiline: { height: 120, marginBottom: 4 },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, paddingVertical: 15, borderRadius: 14, marginTop: 16,
  },
  sendBtnText: { color: colors.background, fontSize: 15, fontWeight: '800' },
});

export default SupportTicketsScreen;
