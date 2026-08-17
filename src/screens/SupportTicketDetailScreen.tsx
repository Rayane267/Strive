import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { fetchMessages, postUserMessage, SupportMessage } from '../services/supportService';
import BrandLoader from '../components/BrandLoader';

const SupportTicketDetailScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { ticketId, subject } = route.params as { ticketId: string; subject: string };

  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    try {
      setMessages(await fetchMessages(ticketId));
    } catch {
      // silencieux
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const msg = await postUserMessage(ticketId, body);
      setMessages(prev => [...prev, msg]);
      setDraft('');
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch {
      // garde le brouillon si échec
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item }: { item: SupportMessage }) => {
    const isUser = item.sender === 'user';
    return (
      <View style={[styles.bubbleRow, isUser ? styles.rowRight : styles.rowLeft]}>
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleStaff]}>
          {!isUser && <Text style={styles.staffLabel}>{t('support.staff', 'Support Strive')}</Text>}
          <Text style={[styles.bubbleText, isUser && { color: colors.background }]}>{item.body}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Feather name="chevron-left" size={30} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{subject || t('support.title', 'Ticket')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {loading ? (
          <BrandLoader style={{ marginTop: 60 }} />
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          />
        )}

        <View style={styles.composer}>
          <TextInput
            style={styles.composerInput}
            value={draft}
            onChangeText={t => setDraft(t.slice(0, 4000))}
            placeholder={t('support.replyPlaceholder', 'Écris ta réponse…')}
            placeholderTextColor={colors.textDimmed}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendIcon, !draft.trim() && { opacity: 0.4 }]}
            onPress={send}
            disabled={sending || !draft.trim()}
            activeOpacity={0.85}
          >
            {sending ? <ActivityIndicator color={colors.background} size="small" />
              : <Feather name="send" size={18} color={colors.background} />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  backBtn: {
    marginLeft: -10,
    width: 44, height: 44, borderRadius: 12, backgroundColor: colors.surface,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  headerCenter: { flex: 1, marginHorizontal: 14 },
  headerTitle: {
    marginRight: 12,
    flex: 1, color: colors.textMain, fontSize: 26, fontWeight: '800' },
  headerSub: { color: colors.textDimmed, fontSize: 12, marginTop: 2 },

  list: { paddingHorizontal: 16, paddingVertical: 16, gap: 10 },
  bubbleRow: { flexDirection: 'row', marginBottom: 2 },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleStaff: {
    backgroundColor: colors.surface, borderBottomLeftRadius: 4,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
  },
  staffLabel: { color: colors.primary, fontSize: 11, fontWeight: '800', marginBottom: 4 },
  bubbleText: { color: colors.textMain, fontSize: 14, lineHeight: 20 },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: colors.background,
  },
  composerInput: {
    flex: 1, maxHeight: 120, minHeight: 44,
    backgroundColor: 'rgba(255,255,255,0.05)', color: colors.textMain,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  sendIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
});

export default SupportTicketDetailScreen;
