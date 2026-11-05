import React from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../components/ui';
import { useTheme } from '../../theme/ThemeContext';

const GAMES = [
  { id: 'truth', icon: 'heart', title: 'Doğruluk veya Cesaret', desc: 'Klasik içtenlik oyunu' },
  { id: 'okey', icon: 'albums', title: 'Okey', desc: 'Taşlı klasik' },
];

export default function GamesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Screen>
      <View style={{ paddingHorizontal: theme.spacing(4), paddingTop: theme.spacing(8), paddingBottom: theme.spacing(3) }}>
        <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.xxl, fontWeight: '800' }}>{t('tabs.games')}</Text>
      </View>
      <FlatList
        data={GAMES}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ padding: theme.spacing(4), gap: theme.spacing(4) }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={{
              backgroundColor: theme.colors.card, borderRadius: theme.radii.lg, padding: theme.spacing(5),
              borderWidth: 1, borderColor: theme.colors.border, ...theme.effects.cardShadow,
            }}
          >
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: theme.colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: theme.spacing(3) }}>
              <Ionicons name={item.icon as any} size={26} color={theme.colors.accent} />
            </View>
            <Text style={{ color: theme.colors.text, fontSize: theme.typography.sizes.lg, fontWeight: '700' }}>{item.title}</Text>
            <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>{item.desc}</Text>
          </TouchableOpacity>
        )}
      />
    </Screen>
  );
}
