import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, FlatList, RefreshControl } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Avatar, Button, Header } from '../../../components/ui';
import { useTheme } from '../../../theme/ThemeContext';
import { useAppStore } from '../../../stores/appStore';
import { supabase } from '../../../lib/supabase';

interface Profile {
  id: string; username: string; display_name: string; bio: string;
  avatar_url: string | null; is_private: boolean; country: string | null; city: string | null;
}
interface Photo { id: string; url: string; position: number; is_main: boolean; }

export default function ProfileScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const uid = useAppStore((s) => s.session?.user.id);
  const params = useLocalSearchParams<{ id?: string }>();
  const targetId = params.id ?? uid;
  const isOwn = targetId === uid;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!targetId) return;
    const [{ data: p }, { data: ph }, { count: fc }, { count: fg }, { data: f }] = await Promise.all([
      supabase.from('profiles').select('id, username, display_name, bio, avatar_url, is_private, country, city').eq('id', targetId).single(),
      supabase.from('profile_photos').select('id, url, position, is_main').eq('user_id', targetId).order('position'),
      supabase.from('user_follows').select('*', { count: 'exact', head: true }).eq('following_id', targetId),
      supabase.from('user_follows').select('*', { count: 'exact', head: true }).eq('follower_id', targetId),
      uid && !isOwn ? supabase.from('user_follows').select('follower_id').eq('follower_id', uid).eq('following_id', targetId).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setProfile(p as Profile);
    setPhotos((ph ?? []) as Photo[]);
    setFollowers(fc ?? 0);
    setFollowing(fg ?? 0);
    setIsFollowing(!!(f as any)?.follower_id);
    setLoading(false); setRefreshing(false);
  }, [targetId, uid, isOwn]);

  useEffect(() => { void load(); }, [load]);

  async function toggleFollow() {
    if (!uid || !targetId || isOwn) return;
    if (isFollowing) {
      await supabase.from('user_follows').delete().eq('follower_id', uid).eq('following_id', targetId);
      setIsFollowing(false); setFollowers((f) => f - 1);
    } else {
      const { error } = await supabase.from('user_follows').insert({ follower_id: uid, following_id: targetId });
      if (!error) { setIsFollowing(true); setFollowers((f) => f + 1); }
    }
  }

  if (loading) return <Screen />;
  if (!profile) return <Screen><Text style={{ color: theme.colors.textMuted, textAlign: 'center', marginTop: 100 }}>Not found</Text></Screen>;

  const mainPhoto = photos.find((p) => p.is_main) ?? photos[0];

  return (
    <Screen>
      <Header
        title={profile.username}
        left={isOwn ? undefined : (
          <TouchableOpacity onPress={() => router.back()} style={{ padding: theme.spacing(2) }}>
            <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
          </TouchableOpacity>
        )}
        right={
          <TouchableOpacity onPress={() => router.push({ pathname: '/report', params: { reportedUserId: targetId, subjectType: 'user' } })} style={{ padding: theme.spacing(2) }}>
            <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.text} />
          </TouchableOpacity>
        }
      />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.colors.accent} />}>
        {/* Cover + avatar */}
        <View style={{ height: 140, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', justifyContent: 'flex-end' }}>
          <View style={{ marginBottom: -40 }}>
            <Avatar uri={mainPhoto?.url ?? profile.avatar_url} name={profile.display_name} size={92} />
            <View style={{ position: 'absolute', bottom: 2, right: 2, width: 16, height: 16, borderRadius: 8, backgroundColor: theme.colors.accent, borderWidth: 2, borderColor: theme.colors.background }} />
          </View>
        </View>
        <View style={{ alignItems: 'center', marginTop: 48, paddingHorizontal: theme.spacing(4) }}>
          <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.xl, fontWeight: '800' }}>{profile.display_name}</Text>
          <Text style={{ color: theme.colors.textMuted }}>@{profile.username}</Text>
          {!!profile.bio && <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: theme.spacing(2) }}>{profile.bio}</Text>}
          {(profile.country || profile.city) && (
            <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.sm, marginTop: 4 }}>
              {[profile.city, profile.country].filter(Boolean).join(', ')}
            </Text>
          )}
          {profile.is_private && <Text style={{ color: theme.colors.warning, fontSize: theme.typography.sizes.xs, marginTop: 4 }}>{t('profile.privateAccount')}</Text>}
        </View>

        {/* Stats */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: theme.spacing(4), gap: theme.spacing(8) }}>
          <Stat label={t('profile.posts')} value={photos.length} />
          <Stat label={t('profile.followers')} value={followers} />
          <Stat label={t('profile.following')} value={following} />
        </View>

        {/* Actions */}
        <View style={{ flexDirection: 'row', gap: theme.spacing(3), padding: theme.spacing(4) }}>
          {isOwn ? (
            <>
              <Button title={t('profile.editProfile')} variant="secondary" onPress={() => router.push('/edit-profile')} style={{ flex: 1 }} />
              <Button title={t('settings.title')} variant="secondary" onPress={() => router.push('/settings')} style={{ flex: 1 }} />
            </>
          ) : (
            <>
              <Button title={isFollowing ? t('profile.unfollow') : t('profile.follow')} onPress={toggleFollow} style={{ flex: 1 }} variant={isFollowing ? 'secondary' : 'primary'} />
              <Button title={t('profile.message')} variant="secondary" onPress={async () => {
                if (!uid) return;
                const { data } = await supabase.rpc('find_or_create_direct', { a: uid, b: targetId });
                if (data) router.push({ pathname: '/chat/[id]', params: { id: data, name: profile.display_name, type: 'direct', otherId: targetId } });
              }} style={{ flex: 1 }} />
            </>
          )}
        </View>

        {/* Photos grid */}
        {photos.length > 0 && (
          <View style={{ paddingHorizontal: theme.spacing(4), paddingBottom: theme.spacing(8) }}>
            <Text style={{ color: theme.colors.text, fontWeight: '700', marginBottom: theme.spacing(3) }}>{t('profile.photos')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {photos.map((p) => (
                <View key={p.id} style={{ width: '32%', aspectRatio: 1, borderRadius: theme.radii.md, overflow: 'hidden', backgroundColor: theme.colors.surfaceAlt }}>
                  {/* eslint-disable-next-line @typescript-eslint/no-var-requires */}
                  <PhotoCell url={p.url} />
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.lg, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs }}>{label}</Text>
    </View>
  );
}

import { Image } from 'expo-image';
function PhotoCell({ url }: { url: string }) {
  return <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />;
}
