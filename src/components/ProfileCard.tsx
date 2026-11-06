import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView, Animated, Easing, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Avatar, Button } from './ui';
import { useTheme } from '../theme/ThemeContext';
import { useAppStore } from '../stores/appStore';
import { supabase } from '../lib/supabase';

interface Props {
  visible: boolean;
  userId: string | null;
  onClose: () => void;
  extraActions?: { label: string; icon: string; onPress: () => void }[];
}

export function ProfileCard({ visible, userId, onClose, extraActions }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const myId = useAppStore((s) => s.session?.user.id);
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState({ followers: 0, following: 0 });
  const [isFollowing, setIsFollowing] = useState(false);
  const [slide] = useState(new Animated.Value(0));

  const isOwn = userId === myId;

  useEffect(() => {
    if (!visible || !userId) return;
    Animated.timing(slide, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    void (async () => {
      const [{ data: p }, { count: fc }, { count: fg }, { data: f }] = await Promise.all([
        supabase.from('profiles').select('id, username, display_name, bio, avatar_url, country, city').eq('id', userId).single(),
        supabase.from('user_follows').select('*', { count: 'exact', head: true }).eq('following_id', userId),
        supabase.from('user_follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId),
        myId ? supabase.from('user_follows').select('follower_id').eq('follower_id', myId).eq('following_id', userId).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      setProfile(p);
      setStats({ followers: fc ?? 0, following: fg ?? 0 });
      setIsFollowing(!!(f as any)?.follower_id);
    })();
  }, [visible, userId]);

  function close() {
    Animated.timing(slide, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => onClose());
  }

  async function toggleFollow() {
    if (!myId || !userId || isOwn) return;
    if (isFollowing) {
      await supabase.from('user_follows').delete().eq('follower_id', myId).eq('following_id', userId);
      setIsFollowing(false); setStats((s) => ({ ...s, followers: s.followers - 1 }));
    } else {
      const { error } = await supabase.from('user_follows').insert({ follower_id: myId, following_id: userId });
      if (!error) { setIsFollowing(true); setStats((s) => ({ ...s, followers: s.followers + 1 })); }
    }
  }

  async function startChat() {
    if (!myId || !userId) return;
    const { data } = await supabase.rpc('find_or_create_direct', { a: myId, b: userId });
    close();
    if (data) router.push({ pathname: '/chat/[id]', params: { id: data, name: profile?.display_name ?? '', type: 'direct', otherId: userId } });
  }

  function block() {
    Alert.alert(t('common.block'), '', [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.block'), style: 'destructive', onPress: async () => {
        if (myId && userId) {
          await supabase.from('user_blocks').insert({ blocker_id: myId, blocked_id: userId });
          close();
        }
      }},
    ]);
  }

  function report() {
    close();
    router.push({ pathname: '/report', params: { reportedUserId: userId, subjectType: 'user' } });
  }

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [400, 0] });

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
      <View style={{ flex: 1 }}>
        <Pressable style={{ flex: 1, backgroundColor: theme.colors.overlay }} onPress={close} />
        <Animated.View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '75%',
          backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radii.xl, borderTopRightRadius: theme.radii.xl,
          transform: [{ translateY }],
          ...theme.effects.cardShadow,
        }}>
          <View style={{ alignItems: 'center', paddingTop: theme.spacing(2) }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: theme.spacing(5), paddingBottom: theme.spacing(8) }}>
            {profile ? (
              <>
                <View style={{ alignItems: 'center' }}>
                  <Avatar uri={profile.avatar_url} name={profile.display_name} size={84} />
                  <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.xl, fontWeight: '800', marginTop: theme.spacing(3) }}>{profile.display_name}</Text>
                  <Text style={{ color: theme.colors.textMuted }}>@{profile.username}</Text>
                </View>
                {(profile.city || profile.country) ? (
                  <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: theme.spacing(2) }}>
                    {[profile.city, profile.country].filter(Boolean).join(', ')}
                  </Text>
                ) : null}
                {!!profile.bio && <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: theme.spacing(2) }}>{profile.bio}</Text>}
                <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.spacing(8), marginTop: theme.spacing(4) }}>
                  <MiniStat label={t('profile.followers')} value={stats.followers} />
                  <MiniStat label={t('profile.following')} value={stats.following} />
                </View>
                <View style={{ flexDirection: 'row', gap: theme.spacing(3), marginTop: theme.spacing(5) }}>
                  {isOwn ? (
                    <Button title={t('profile.editProfile')} variant="secondary" onPress={() => { close(); router.push('/edit-profile'); }} style={{ flex: 1 }} />
                  ) : (
                    <>
                      <Button title={isFollowing ? t('profile.unfollow') : t('profile.follow')} onPress={toggleFollow} style={{ flex: 1 }} variant={isFollowing ? 'secondary' : 'primary'} />
                      <Button title={t('profile.message')} variant="secondary" onPress={startChat} style={{ flex: 1 }} />
                    </>
                  )}
                  <TouchableOpacity onPress={() => { close(); router.push({ pathname: '/user/[id]', params: { id: userId } }); }} style={{ padding: theme.spacing(3), borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border }}>
                    <Ionicons name="person-circle-outline" size={22} color={theme.colors.text} />
                  </TouchableOpacity>
                </View>
                {!isOwn && (
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.spacing(6), marginTop: theme.spacing(4) }}>
                    <TouchableOpacity onPress={block} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="ban-outline" size={16} color={theme.colors.danger} />
                      <Text style={{ color: theme.colors.danger, fontSize: theme.typography.sizes.sm }}>{t('common.block')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={report} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="flag-outline" size={16} color={theme.colors.warning} />
                      <Text style={{ color: theme.colors.warning, fontSize: theme.typography.sizes.sm }}>{t('common.report')}</Text>
                    </TouchableOpacity>
                    {extraActions?.map((a) => (
                      <TouchableOpacity key={a.label} onPress={a.onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Ionicons name={a.icon as any} size={16} color={theme.colors.accent} />
                        <Text style={{ color: theme.colors.accent, fontSize: theme.typography.sizes.sm }}>{a.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <Text style={{ color: theme.colors.textMuted, textAlign: 'center' }}>{t('common.loading')}</Text>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.lg, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>{label}</Text>
    </View>
  );
}
