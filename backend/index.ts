import { router, json, error, db } from '@appdeploy/sdk';
import {
  notifySubscribers,
  realtimeSubscriptionRoutes,
} from './realtime-subscribers';

type OrderRecord = {
  customerName: string;
  restaurant: string;
  items: Array<{ name: string; qty: number; price: number }>;
  foodSubtotal: number;
  deliveryFee: number;
  total: number;
  restaurantPayout: number;
  driverPayout: number;
  nahaLabsRevenue: number;
  address: string;
  status: string;
  driverName?: string;
  createdAt: number;
};

function calculateAllocation(food: number, delivery: number) {
  const restaurant = Math.round(food * 0.92 * 100) / 100;
  const nahaLabs =
    Math.round((food * 0.08 + Math.min(3, delivery)) * 100) / 100;
  const driver = Math.round((delivery - Math.min(3, delivery)) * 100) / 100;
  return { restaurant, driver, nahaLabs };
}

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],

  'GET /api/orders': [
    async () => {
      const result = await db.list<OrderRecord>('flavourly_orders', {
        limit: 100,
      });
      const orders = result.items.sort((a, b) => b.createdAt - a.createdAt);
      return json({ orders });
    },
  ],

  'POST /api/orders': [
    async ({ body }) => {
      const input = (body || {}) as Partial<OrderRecord>;
      if (!input.items?.length || !input.address?.trim() || !input.restaurant) {
        return error(
          'A basket, restaurant and delivery address are required',
          400
        );
      }
      if (
        !Number.isFinite(input.foodSubtotal) ||
        !Number.isFinite(input.deliveryFee) ||
        input.foodSubtotal! <= 0 ||
        input.deliveryFee! < 0
      ) {
        return error('Order totals are invalid', 400);
      }
      const items = input.items.map(item => ({
        name: String(item.name).slice(0, 100),
        qty: Math.max(1, Math.min(50, Math.floor(Number(item.qty) || 1))),
        price: Math.max(0, Number(item.price) || 0),
      }));
      const foodSubtotal =
        Math.round(
          items.reduce((sum, item) => sum + item.qty * item.price, 0) * 100
        ) / 100;
      const deliveryFee = Math.round(Number(input.deliveryFee) * 100) / 100;
      const parts = calculateAllocation(foodSubtotal, deliveryFee);
      const record: OrderRecord = {
        customerName: String(input.customerName || 'Guest').slice(0, 80),
        restaurant: String(input.restaurant).slice(0, 120),
        items,
        foodSubtotal,
        deliveryFee,
        total: Math.round((foodSubtotal + deliveryFee) * 100) / 100,
        restaurantPayout: parts.restaurant,
        driverPayout: parts.driver,
        nahaLabsRevenue: parts.nahaLabs,
        address: String(input.address).slice(0, 250),
        status: 'placed',
        createdAt: Date.now(),
      };
      const [id] = await db.add('flavourly_orders', [record]);
      if (!id) return error('Could not save the order', 500);
      const order = { ...record, id };
      await notifySubscribers('orders', 'all', order);
      return json({ order }, 201);
    },
  ],

  'PUT /api/orders/:id': [
    async ({ params, body }) => {
      const [saved] = await db.get<OrderRecord>(
        'flavourly_orders',
        [params.id],
        { consistent: true }
      );
      if (!saved) return error('Order not found', 404);
      const input = (body || {}) as { status?: string; driverName?: string };
      const allowed = [
        'placed',
        'accepted',
        'preparing',
        'ready',
        'picked_up',
        'delivered',
      ];
      if (!input.status || !allowed.includes(input.status))
        return error('Invalid order status', 400);
      const updated: OrderRecord = {
        ...saved,
        status: input.status,
        ...(input.driverName
          ? { driverName: String(input.driverName).slice(0, 80) }
          : {}),
      };
      const [ok] = await db.update('flavourly_orders', [
        { id: params.id, record: updated },
      ]);
      if (!ok) return error('Could not update the order', 409);
      const order = { ...updated, id: params.id };
      await notifySubscribers('orders', 'all', order);
      return json({ order });
    },
  ],

  ...realtimeSubscriptionRoutes,
});
