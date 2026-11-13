import { db, ws, json, error } from '@appdeploy/sdk';

type SubscriptionRecord = {
  id: string;
  entity_type: string;
  entity_id: string;
  connection_id: string;
  created_at: number;
};

async function listSubscriptions(): Promise<SubscriptionRecord[]> {
  const { items } = await db.list<SubscriptionRecord>('entity_subscriptions', {
    limit: 1000,
  });
  return items;
}

export async function removeSubscriptionsByConnection(connectionId: string) {
  const items = await listSubscriptions();
  const ids = items
    .filter(item => item.connection_id === connectionId)
    .map(item => item.id);
  if (ids.length) await db.delete('entity_subscriptions', ids);
}

export async function notifySubscribers(
  entityType: string,
  entityId: string,
  payload: unknown
) {
  const items = await listSubscriptions();
  const targets = Array.from(
    new Set(
      items
        .filter(
          item => item.entity_type === entityType && item.entity_id === entityId
        )
        .map(item => item.connection_id)
    )
  );
  if (targets.length)
    await ws.send(targets, {
      v: 1,
      type: 'entity.update',
      payload: { entity_type: entityType, entity_id: entityId, data: payload },
    });
}

export const realtimeSubscriptionRoutes = {
  'POST /api/subscriptions': [
    async ({ body }) => {
      const input = (body || {}) as {
        entity_type?: string;
        entity_id?: string;
        connection_id?: string;
      };
      if (!input.entity_type || !input.entity_id || !input.connection_id)
        return error(
          'entity_type, entity_id and connection_id are required',
          400
        );
      await db.add('entity_subscriptions', [
        {
          entity_type: input.entity_type,
          entity_id: input.entity_id,
          connection_id: input.connection_id,
          created_at: Date.now(),
        },
      ]);
      return json({ ok: true });
    },
  ],
  'POST /api/subscriptions/remove': [
    async ({ body }) => {
      const input = (body || {}) as {
        entity_type?: string;
        entity_id?: string;
        connection_id?: string;
      };
      if (!input.entity_type || !input.entity_id || !input.connection_id)
        return error(
          'entity_type, entity_id and connection_id are required',
          400
        );
      const items = await listSubscriptions();
      const ids = items
        .filter(
          item =>
            item.entity_type === input.entity_type &&
            item.entity_id === input.entity_id &&
            item.connection_id === input.connection_id
        )
        .map(item => item.id);
      if (ids.length) await db.delete('entity_subscriptions', ids);
      return json({ ok: true });
    },
  ],
};
