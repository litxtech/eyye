import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { supabase } from './supabase';

export interface SavedAccount {
  email: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string | null;
  savedAt: number;
}

const LIST_KEY = 'eyye-saved-accounts';
const pwKey = (email: string) => `eyye-acct-pw-${email.toLowerCase()}`;

async function readList(): Promise<SavedAccount[]> {
  try {
    const raw = await AsyncStorage.getItem(LIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function writeList(list: SavedAccount[]) {
  await AsyncStorage.setItem(LIST_KEY, JSON.stringify(list.slice(0, 10)));
}

export async function listAccounts(): Promise<SavedAccount[]> {
  const list = await readList();
  return list.sort((a, b) => b.savedAt - a.savedAt);
}

// Call after a successful email/password sign-in.
export async function saveAccount(userId: string, email: string, password: string) {
  const e = email.trim().toLowerCase();
  let displayName: string | undefined, username: string | undefined, avatarUrl: string | null | undefined;
  try {
    const { data } = await supabase.from('profiles').select('display_name, username, avatar_url')
      .eq('id', userId).maybeSingle();
    displayName = data?.display_name ?? undefined;
    username = data?.username ?? undefined;
    avatarUrl = data?.avatar_url ?? null;
  } catch { /* profile may not exist yet */ }
  try {
    if (Platform.OS === 'web') await AsyncStorage.setItem(pwKey(e), password);
    else await SecureStore.setItemAsync(pwKey(e), password);
  } catch { /* ignore */ }
  const list = await readList();
  const rest = list.filter((a) => a.email !== e);
  rest.unshift({ email: e, displayName, username, avatarUrl, savedAt: Date.now() });
  await writeList(rest);
}

export async function getAccountPassword(email: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return await AsyncStorage.getItem(pwKey(email));
    return await SecureStore.getItemAsync(pwKey(email));
  } catch {
    return null;
  }
}

export async function removeAccount(email: string) {
  const list = (await readList()).filter((a) => a.email !== email);
  await writeList(list);
  try {
    if (Platform.OS === 'web') await AsyncStorage.removeItem(pwKey(email));
    else await SecureStore.deleteItemAsync(pwKey(email));
  } catch { /* ignore */ }
}

export async function clearAccounts() {
  const list = await readList();
  for (const a of list) await removeAccount(a.email);
}
