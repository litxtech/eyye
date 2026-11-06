import { router } from 'expo-router';

// Maps push-notification payloads and eyye:// deep links to app routes.
export function routeForNotification(data: any) {
  const type = data?.type as string | undefined;
  const id = data?.conversation_id ?? data?.chat_id ?? data?.id;
  switch (type) {
    case 'chat':
    case 'message':
      if (id) return { pathname: '/chat/[id]', params: { id, name: data?.name ?? '', type: 'direct' } };
      return '/chats';
    case 'follow':
    case 'profile':
      if (data?.user_id) return { pathname: '/user/[id]', params: { id: data.user_id } };
      return '/profile';
    case 'okey_invite':
    case 'okey':
      if (data?.table_id) return { pathname: '/okey/[id]', params: { id: data.table_id, room: data?.room ?? '', role: 'player' } };
      return '/okey';
    case 'td_invite':
    case 'truth_dare':
      if (data?.room_id) return { pathname: '/truth-dare/[id]', params: { id: data.room_id, role: 'player' } };
      return '/truth-dare';
    case 'notification':
      return '/notifications';
    default:
      if (id && data?.kind === 'okey') return { pathname: '/okey/[id]', params: { id } };
      return null;
  }
}

export function openNotification(data: any) {
  const route = routeForNotification(data);
  if (!route) return;
  try {
    if (typeof route === 'string') router.push(route as any);
    else router.push(route as any);
  } catch { /* nav not ready */ }
}

// eyye:// deep links — expo-router resolves these automatically, but
// normalize a few aliases here for share links.
export function routeForDeepLink(url: string): any {
  try {
    const u = new URL(url);
    if (u.protocol !== 'eyye:') return null;
    // eyye://chat/<id>?name=..  -> /chat/<id>
    const seg = u.hostname || u.pathname.replace(/^\//, '');
    const parts = seg.split('/').filter(Boolean);
    if (!parts.length) return null;
    const [head, ...rest] = parts;
    const q = u.searchParams;
    switch (head) {
      case 'chat':
        return rest[0] ? { pathname: '/chat/[id]', params: { id: rest[0], name: q.get('name') ?? '', type: q.get('type') ?? 'direct' } } as any : '/chats';
      case 'user':
      case 'profile':
        return rest[0] ? { pathname: '/user/[id]', params: { id: rest[0] } } as any : '/profile';
      case 'okey':
        return rest[0] ? { pathname: '/okey/[id]', params: { id: rest[0], room: q.get('room') ?? '', role: q.get('role') ?? 'player' } } as any : '/okey';
      case 'truth-dare':
      case 'td':
        return rest[0] ? { pathname: '/truth-dare/[id]', params: { id: rest[0], role: q.get('role') ?? 'player' } } as any : '/truth-dare';
      case 'report':
        return '/report';
      default:
        return null;
    }
  } catch {
    return null;
  }
}
