import React from 'react';
import { View, Image } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { colors } from '../theme/colors';

// ── 6 AVATARS GÉNÉRIQUES (illustrations DiceBear lorelei — style dessin) ──
// 3 hommes / 3 femmes
export const AVATAR_PRESETS = [
  {
    id: 'preset:m0',
    url: 'https://api.dicebear.com/9.x/lorelei/png?seed=Thomas&size=200&backgroundColor=0a120e',
    label: 'Thomas',
    gender: 'H' as const,
  },
  {
    id: 'preset:m1',
    url: 'https://api.dicebear.com/9.x/lorelei/png?seed=Alexandre&size=200&backgroundColor=0a120e',
    label: 'Alex',
    gender: 'H' as const,
  },
  {
    id: 'preset:m2',
    url: 'https://api.dicebear.com/9.x/lorelei/png?seed=Karim&size=200&backgroundColor=0a120e',
    label: 'Karim',
    gender: 'H' as const,
  },
  {
    id: 'preset:f0',
    url: 'https://api.dicebear.com/9.x/lorelei/png?seed=Camille&size=200&backgroundColor=0a120e',
    label: 'Camille',
    gender: 'F' as const,
  },
  {
    id: 'preset:f1',
    url: 'https://api.dicebear.com/9.x/lorelei/png?seed=Sophie&size=200&backgroundColor=0a120e',
    label: 'Sophie',
    gender: 'F' as const,
  },
  {
    id: 'preset:f2',
    url: 'https://api.dicebear.com/9.x/lorelei/png?seed=Leila&size=200&backgroundColor=0a120e',
    label: 'Leila',
    gender: 'F' as const,
  },
] as const;

export type AvatarPreset = typeof AVATAR_PRESETS[number];

interface AvatarViewProps {
  avatarId: string;
  size: number;
  borderColor?: string;
}

const AvatarView = ({ avatarId, size, borderColor }: AvatarViewProps) => {
  const preset = AVATAR_PRESETS.find(p => p.id === avatarId);

  if (preset) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          borderWidth: 2.5,
          borderColor: borderColor ?? colors.primary,
          backgroundColor: '#0a120e',
        }}
      >
        <Image
          source={{ uri: preset.url }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="cover"
        />
      </View>
    );
  }

  // Fallback générique
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.surface,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2.5,
        borderColor: borderColor ?? colors.primary,
      }}
    >
      <Feather name="user" size={size * 0.42} color={colors.textMuted} />
    </View>
  );
};

export default AvatarView;
