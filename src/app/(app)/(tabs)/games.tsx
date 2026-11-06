import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../../components/ui';
import { useTheme } from '../../../theme/ThemeContext';

const GAMES = [
  {
    id: 'okey',
    icon: 'albums',
    title: 'VIP Okey',
    desc: '4 oyunculu premium masa',
    desc2: 'LiveKit sesli sohbetli',
    route: '/okey',
    color: '#E8C97A',
  },
  {
    id: 'truth',
    icon: 'heart',
    title: 'Doğruluk / Cesaret',
    desc: 'Çark çevir, kanıtla',
    desc2: 'Özel odalar, tek-görüntüleme',
    route: '/truth-dare',
    color: '#E85D75',
  },
] as const;

export default function GamesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: theme.spacing(4), paddingTop: theme.spacing(8), paddingBottom: 96 }}>
        <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.xxl, fontWeight: '800', marginBottom: theme.spacing(4) }}>
          {t('tabs.games')}
        </Text>
        {GAMES.map((g) => (
          <TouchableOpacity key={g.id} onPress={() => router.push(g.route)} activeOpacity={0.85} style={styles.card}>
            <LinearGradient
              colors={[g.color + '22', 'transparent']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={styles.cardGradient}
            />
            <View style={styles.iconWrap}>
              <Ionicons name={g.icon} size={28} color={g.color} />
            </View>
            <View style={{ flex: 1, marginLeft: theme.spacing(4) }}>
              <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.lg, fontWeight: '700' }}>{g.title}</Text>
              <Text style={{ color: theme.colors.textSecondary, fontSize: theme.typography.sizes.sm, marginTop: 2 }}>{g.desc}</Text>
              <Text style={{ color: theme.colors.textMuted, fontSize: theme.typography.sizes.xs, marginTop: 1 }}>{g.desc2}</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={theme.colors.textMuted} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141010',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2A1A12',
    padding: 16,
    marginBottom: 16,
    position: 'relative',
    overflow: 'hidden',
  },
  cardGradient: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  iconWrap: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: '#241811',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#3A2A1A',
  },
});
