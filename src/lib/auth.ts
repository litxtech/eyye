import { supabase } from './supabase';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

export function isValidUsername(u: string): boolean {
  return /^[a-zA-Z0-9_]{3,20}$/.test(u) &&
    !['admin','administrator','moderator','support','official','eyye','system','root','null','undefined','eyyeapp','help','security','safety','api','www','app'].includes(u.toLowerCase());
}

export async function checkUsernameAvailable(username: string, excludeId?: string): Promise<boolean> {
  if (!isValidUsername(username)) return false;
  const { data, error } = await supabase.rpc('username_available', {
    u: username.toLowerCase(),
    exclude_user: excludeId ?? null,
  });
  if (error) return false;
  return data === true;
}

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email: email.trim(), password });
}

export async function signUp(params: {
  email: string; password: string; firstName: string; lastName: string;
  username: string; birthDate: string; country?: string; city?: string;
}) {
  return supabase.auth.signUp({
    email: params.email.trim(),
    password: params.password,
    options: {
      data: {
        username: params.username.toLowerCase(),
        first_name: params.firstName,
        last_name: params.lastName,
        birth_date: params.birthDate,
        country: params.country,
        city: params.city,
      },
    },
  });
}

export async function verifyEmailOtp(email: string, token: string) {
  return supabase.auth.verifyOtp({ email: email.trim(), token, type: 'signup' });
}

export async function resendSignupOtp(email: string) {
  return supabase.auth.resend({ type: 'signup', email: email.trim() });
}

export async function sendPasswordReset(email: string) {
  return supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: 'eyye://reset',
  });
}

export async function verifyRecoveryOtp(email: string, token: string) {
  return supabase.auth.verifyOtp({ email: email.trim(), token, type: 'recovery' });
}

export async function updatePassword(password: string) {
  return supabase.auth.updateUser({ password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function signInWithApple() {
  if (Platform.OS !== 'ios') return { error: new Error('Apple sign-in is only available on iOS') };
  try {
    const AppleAuthentication = await import('expo-apple-authentication');
    const rawNonce = Crypto.randomUUID().replace(/-/g, '');
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) return { error: new Error('No identity token') };
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });
    // Apple only sends name/email on first authorization — store in metadata if present
    if (data.user && (credential.fullName?.givenName || credential.email)) {
      await supabase.auth.updateUser({
        data: {
          first_name: credential.fullName?.givenName ?? undefined,
          last_name: credential.fullName?.familyName ?? undefined,
        },
      });
    }
    return { data, error };
  } catch (e: any) {
    if (e?.code === 'ERR_REQUEST_CANCELED' || e?.code === 'ERR_CANCELED') return { cancelled: true };
    return { error: e };
  }
}

export async function signInWithGoogle() {
  try {
    const redirectUri = 'eyye://auth/callback';
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectUri, skipBrowserRedirect: true },
    });
    if (error) return { error };
    if (!data?.url) return { error: new Error('No OAuth URL') };
    const res = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);
    if (res.type !== 'success' || !res.url) return { cancelled: true };
    const params = new URL(res.url).searchParams ?? new URLSearchParams(res.url.split('#')[1] ?? '');
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (!access_token) {
      // PKCE flow: exchange code if present
      const code = params.get('code');
      if (code) {
        const { data: sess, error: e2 } = await supabase.auth.exchangeCodeForSession(code);
        return { data: sess, error: e2 };
      }
      return { error: new Error('OAuth failed') };
    }
    const { data: sess, error: e2 } = await supabase.auth.setSession({ access_token, refresh_token: refresh_token ?? '' });
    return { data: sess, error: e2 };
  } catch (e: any) {
    return { error: e };
  }
}
