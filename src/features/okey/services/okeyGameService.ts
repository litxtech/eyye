import { supabase } from '../../../lib/supabase';

export async function loadOkeyState(tableId: string) {
  return supabase.rpc('okey_state', { p_table: tableId });
}

export async function startOkeyRound(tableId: string) {
  return supabase.rpc('okey_start', { p_table: tableId, p_fill_bots: true });
}

export async function leaveOkeyTable(tableId: string) {
  return supabase.rpc('okey_leave_table', { p_table: tableId });
}

export async function sendOkeyChat(tableId: string, body: string) {
  return supabase.rpc('okey_chat_send', { p_table: tableId, p_body: body });
}

export async function inviteToOkey(tableId: string, toUserId: string) {
  return supabase.rpc('okey_invite', { p_table: tableId, p_to: toUserId });
}
