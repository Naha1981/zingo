import { removeSubscriptionsByConnection } from './realtime-subscribers';

export const realtime = async (event: any) => {
  let message: any = {};
  try {
    message = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 200 };
  }
  if (message.type === 'system.connected') return { statusCode: 200 };
  if (message.type === 'system.disconnected') {
    const connectionId = message.payload?.connection_id;
    if (connectionId) await removeSubscriptionsByConnection(connectionId);
  }
  return { statusCode: 200 };
};
