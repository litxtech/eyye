import type { OkeyValue } from '../../../components/OkeyTile';

export type OkeyMode = 'solo' | 'pairs';
export type OkeyStatus = 'waiting' | 'playing' | 'finished' | 'closed';

export type OkeyPlayer = {
  seat: number;
  user_id: string | null;
  connected?: boolean;
  is_bot?: boolean;
  team?: number | null;
  score?: number;
  hand_count?: number;
  bot_for?: string | null;
};

export type OkeyState = {
  phase?: 'draw' | 'discard';
  turn_seat?: number;
  turn_started_at?: string;
  turn_seconds?: number;
  stock_count?: number;
  discards?: Record<string, number[]>;
  indicator?: number;
  okey?: OkeyValue | null;
  round?: number;
  result?: any;
};

export type OkeyTableData = {
  table: {
    id: string;
    host_id: string;
    name: string;
    status: OkeyStatus;
    mode: OkeyMode;
    livekit_room?: string | null;
  };
  state: OkeyState;
  players: OkeyPlayer[];
  my_hand: number[];
  my_seat: number;
  is_viewer?: boolean;
  viewer_count?: number;
};
