import { supabase } from '../../../lib/supabase';
import type { OkeyMode } from '../types/okey.types';

type CreateTableParams = {
  roomName: string;
  mode: OkeyMode;
  name: string;
  turnSec: number;
  allowViewers: boolean;
  password?: string | null;
};

export async function createOkeyTable(params: CreateTableParams) {
  return supabase.rpc('okey_create_table', {
    p_room_name: params.roomName,
    p_mode: params.mode,
    p_name: params.name,
    p_turn_seconds: params.turnSec,
    p_allow_viewers: params.allowViewers,
    p_password: params.password ?? null,
  });
}

export async function findOkeyTable(codeOrId: string) {
  return supabase.rpc('okey_find_table', { p_code: codeOrId });
}

export async function joinOkeyTable(tableId: string, password?: string | null) {
  return supabase.rpc('okey_join_table', { p_table: tableId, p_password: password ?? null });
}

export async function watchOkeyTable(tableId: string, password?: string | null) {
  return supabase.rpc('okey_watch', { p_table: tableId, p_password: password ?? null });
}

export async function quickJoinOkeyTable() {
  return supabase.rpc('okey_quick_join');
}
