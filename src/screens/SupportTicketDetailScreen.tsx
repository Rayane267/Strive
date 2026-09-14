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
import { radius } from '../theme/radius';
import { space } from '../theme/spacing';
import { stroke, strokeWidth } from '../theme/stroke';
import { fetchMessages, postUserMessage, SupportMessage } from '../services/supportService';
import BrandLoader from '../components/BrandLoader';
import { FIELD_TOP } from '../theme/field';
import ScreenField from '../components/ScreenField';
import AnimatedEntrance from '../components/AnimatedEntrance';

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
      {/* Pose en premier, donc derriere tout le reste. Il remplit la zone SOUS
          l'encoche, et `container` porte la meme couleur que son sommet : la
          bande de statut se confond avec lui au lieu de faire un bandeau. */}
      <ScreenField />
      <AnimatedEntrance step={0} style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Feather name="chevron-left" size={30} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{subject || t('support.title', 'Ticket')}</Text>
        <View style={{ width: 38 }} />
      </AnimatedEntrance>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        {loading ? (
          <BrandLoader style={{ marginTop: space.xxxl }} />
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
  container: { flex: 1, backgroundColor: FIELD_TOP },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.xl, paddingVertical: space.md,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  backBtn: {
    marginLeft: -10,
    width: 44, height: 44,
    justifyContent: 'center', alignItems: 'center',
  },
  headerCenter: { flex: 1, marginHorizontal: space.md },
  headerTitle: {
    marginRight: space.md,
    flex: 1, color: colors.textMain, fontSize: 26, fontWeight: '800' },
  headerSub: { color: colors.textDimmed, fontSize: 12, marginTop: space.tight },

  list: { paddingHorizontal: space.lg, paddingVertical: space.lg, gap: space.sm },
  bubbleRow: { flexDirection: 'row', marginBottom: space.tight },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  bubbleUser: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleStaff: {
    backgroundColor: colors.surface, borderBottomLeftRadius: 4,
    borderWidth: strokeWidth.control, borderColor: stroke.edge,
  },
  staffLabel: { color: colors.primary, fontSize: 11, fontWeight: '800', marginBottom: space.xs },
  bubbleText: { color: colors.textMain, fontSize: 14, lineHeight: 20 },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: space.sm,
    paddingHorizontal: space.md, paddingVertical: space.sm,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: colors.background,
  },
  composerInput: {
    flex: 1, maxHeight: 120, minHeight: 44,
    backgroundColor: 'rgba(255,255,255,0.05)', color: colors.textMain,
    borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: 15,
    borderWidth: strokeWidth.control, borderColor: stroke.edge,
  },
  sendIcon: {
    width: 44, height: 44, borderRadius: radius.full, backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
});

export default SupportTicketDetailScreen;
