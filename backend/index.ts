import {
  router,
  json,
  error,
  db,
  requireAuth,
  withScopes,
  requireAdminEmailAllowlist,
} from '@appdeploy/sdk';

const ADMIN_EMAILS = ['thabiso@nahalabs.co.za'];

type Role = 'customer' | 'restaurant' | 'driver';
type ProfileStatus = 'active' | 'pending' | 'approved' | 'rejected';
type UserProfile = {
  email: string;
  role: Role;
  status: ProfileStatus;
  fullName: string;
  phone?: string;
  businessName?: string;
  businessAddress?: string;
  cuisine?: string;
  vehicleType?: string;
  vehicleRegistration?: string;
  createdAt: number;
  updatedAt: number;
  approvedAt?: number;
  approvedBy?: string;
};
type OrderItem = { name: string; qty: number; price: number };
type OrderRecord = {
  customerId: string;
  customerName: string;
  restaurant: string;
  items: OrderItem[];
  foodSubtotal: number;
  deliveryFee: number;
  total: number;
  restaurantPayout: number;
  driverPayout: number;
  nahaLabsRevenue: number;
  address: string;
  status: string;
  driverId?: string;
  driverName?: string;
  createdAt: number;
};

const MENU_PRICES: Record<string, number> = {
  'Double Smash Burger': 89,
  'Margherita Pizza': 105,
  'Crispy Chicken Bowl': 96,
  'Loaded Chips': 48,
  'Classic Cheeseburger': 76,
  'Pepperoni Pizza': 119,
};
const RESTAURANTS = ['The Local Kitchen', 'Fire & Flour', 'Green Bowl Co.'];

function calculateAllocation(food: number, delivery: number) {
  const restaurant = Math.round(food * 0.92 * 100) / 100;
  const nahaLabs = Math.round((food * 0.08 + Math.min(3, delivery)) * 100) / 100;
  const driver = Math.round((delivery - Math.min(3, delivery)) * 100) / 100;
  return { restaurant, driver, nahaLabs };
}

async function getProfile(userId: string) {
  const [profile] = await db.get<UserProfile>('zingo_profiles', [userId], {
    consistent: true,
  });
  return profile;
}

function isAdmin(email?: string) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],

  'GET /api/profile': [
    requireAuth(),
    withScopes('email'),
    async ({ user }) => {
      if (isAdmin(user!.email))
        return json({
          profile: {
            role: 'admin',
            status: 'approved',
            fullName: user!.name || 'NahaLabs Administrator',
            email: user!.email,
          },
        });
      const profile = await getProfile(user!.userId);
      return json({ profile: profile ? { ...profile, id: user!.userId } : null });
    },
  ],

  'POST /api/onboarding': [
    requireAuth(),
    withScopes('email'),
    async ({ user, body }) => {
      if (isAdmin(user!.email))
        return error('The NahaLabs administrator account is assigned automatically', 409);
      const input = (body || {}) as {
        role?: string;
        fullName?: string;
        phone?: string;
        businessName?: string;
        businessAddress?: string;
        cuisine?: string;
        vehicleType?: string;
        vehicleRegistration?: string;
      };
      if (!['customer', 'restaurant', 'driver'].includes(input.role || ''))
        return error('Choose customer, restaurant or driver', 400);
      const role = input.role as Role;
      const fullName = String(input.fullName || '').trim().slice(0, 100);
      const phone = String(input.phone || '').trim().slice(0, 30);
      if (!fullName) return error('Your full name is required', 400);
      if (role !== 'customer' && !phone)
        return error('A contact phone number is required', 400);
      if (role === 'restaurant' && (
        !String(input.businessName || '').trim() ||
        !String(input.businessAddress || '').trim()
      )) return error('Restaurant name and address are required', 400);
      if (role === 'driver' && (
        !String(input.vehicleType || '').trim() ||
        !String(input.vehicleRegistration || '').trim()
      )) return error('Vehicle type and registration are required', 400);

      const now = Date.now();
      const record: UserProfile = {
        email: user!.email!,
        role,
        status: role === 'customer' ? 'active' : 'pending',
        fullName,
        ...(phone ? { phone } : {}),
        ...(role === 'restaurant' ? {
          businessName: String(input.businessName).trim().slice(0, 120),
          businessAddress: String(input.businessAddress).trim().slice(0, 240),
          cuisine: String(input.cuisine || '').trim().slice(0, 100),
        } : {}),
        ...(role === 'driver' ? {
          vehicleType: String(input.vehicleType).trim().slice(0, 60),
          vehicleRegistration: String(input.vehicleRegistration).trim().slice(0, 30),
        } : {}),
        createdAt: now,
        updatedAt: now,
      };
      const [id] = await db.tx.add('zingo_profiles', [{ id: user!.userId, ...record }]);
      if (!id) return error('An account profile already exists. Refresh and sign in again.', 409);
      return json({ profile: { ...record, id } }, 201);
    },
  ],

  'GET /api/admin/applications': [
    requireAuth(),
    withScopes('email'),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    async () => {
      const result = await db.list<UserProfile>('zingo_profiles', { limit: 100 });
      const applications = result.items
        .filter(profile => profile.role !== 'customer' && profile.status === 'pending')
        .sort((a, b) => a.createdAt - b.createdAt);
      return json({ applications });
    },
  ],

  'PUT /api/admin/applications/:id': [
    requireAuth(),
    withScopes('email'),
    requireAdminEmailAllowlist(ADMIN_EMAILS),
    async ({ params, body, user }) => {
      const input = (body || {}) as { decision?: string };
      if (!['approved', 'rejected'].includes(input.decision || ''))
        return error('Choose approve or reject', 400);
      const [profile] = await db.get<UserProfile>('zingo_profiles', [params.id], {
        consistent: true,
      });
      if (!profile || profile.role === 'customer') return error('Application not found', 404);
      if (profile.status !== 'pending') return error('Application has already been reviewed', 409);
      const now = Date.now();
      const [updated] = await db.tx.update('zingo_profiles', [{
        id: params.id,
        record: {
          status: input.decision,
          updatedAt: now,
          approvedAt: input.decision === 'approved' ? now : undefined,
          approvedBy: user!.email,
        },
        if: { status: 'pending' },
      }], { patch: true });
      if (!updated) return error('Application changed; refresh and try again', 409);
      return json({ ok: true, status: input.decision });
    },
  ],

  'GET /api/orders': [
    requireAuth(),
    withScopes('email'),
    async ({ user }) => {
      const admin = isAdmin(user!.email);
      const profile = admin ? null : await getProfile(user!.userId);
      if (!admin && (!profile || (profile.status !== 'active' && profile.status !== 'approved')))
        return error('Complete onboarding and wait for approval before accessing orders', 403);
      const result = await db.list<OrderRecord>('flavourly_orders', { limit: 100 });
      let orders = result.items;
      if (!admin) {
        if (profile!.role === 'customer')
          orders = orders.filter(order => order.customerId === user!.userId);
        else if (profile!.role === 'restaurant')
          orders = orders.filter(order => order.restaurant === profile!.businessName);
        else
          orders = orders.filter(order => order.driverId === user!.userId || (order.status === 'ready' && !order.driverId))
            .map(order => order.driverId === user!.userId
              ? order
              : { ...order, address: 'Accept this delivery to view the drop-off address', customerName: 'Customer' });
      }
      orders.sort((a, b) => b.createdAt - a.createdAt);
      return json({ orders });
    },
  ],

  'POST /api/orders': [
    requireAuth(),
    withScopes('email'),
    async ({ user, body }) => {
      const profile = await getProfile(user!.userId);
      if (!profile || profile.role !== 'customer' || profile.status !== 'active')
        return error('Only active customer accounts can place orders', 403);
      const input = (body || {}) as {
        items?: Array<{ name?: string; qty?: number }>;
        restaurant?: string;
        address?: string;
      };
      if (!input.items?.length || !input.address?.trim() || !input.restaurant)
        return error('A basket, restaurant and delivery address are required', 400);
      if (!RESTAURANTS.includes(input.restaurant))
        return error('This restaurant is not currently available in the pilot', 400);
      const items: OrderItem[] = [];
      for (const row of input.items) {
        const name = String(row.name || '');
        const price = MENU_PRICES[name];
        const qty = Math.floor(Number(row.qty));
        if (!price || !Number.isFinite(qty) || qty < 1 || qty > 20)
          return error('One or more menu items are invalid', 400);
        items.push({ name, qty, price });
      }
      const foodSubtotal = Math.round(items.reduce((sum, item) => sum + item.qty * item.price, 0) * 100) / 100;
      const deliveryFee = 35;
      const parts = calculateAllocation(foodSubtotal, deliveryFee);
      const record: OrderRecord = {
        customerId: user!.userId,
        customerName: profile.fullName,
        restaurant: input.restaurant,
        items,
        foodSubtotal,
        deliveryFee,
        total: Math.round((foodSubtotal + deliveryFee) * 100) / 100,
        restaurantPayout: parts.restaurant,
        driverPayout: parts.driver,
        nahaLabsRevenue: parts.nahaLabs,
        address: String(input.address).trim().slice(0, 250),
        status: 'placed',
        createdAt: Date.now(),
      };
      const [id] = await db.add('flavourly_orders', [record]);
      if (!id) return error('Could not save the order', 500);
      return json({ order: { ...record, id } }, 201);
    },
  ],

  'PUT /api/orders/:id': [
    requireAuth(),
    withScopes('email'),
    async ({ params, body, user }) => {
      const admin = isAdmin(user!.email);
      const profile = admin ? null : await getProfile(user!.userId);
      if (!admin && (!profile || profile.status !== 'approved'))
        return error('An approved restaurant or driver account is required', 403);
      const [saved] = await db.get<OrderRecord>('flavourly_orders', [params.id], {
        consistent: true,
      });
      if (!saved) return error('Order not found', 404);
      const input = (body || {}) as { status?: string };
      let patch: Record<string, unknown>;
      if (admin) {
        return error('Use role-specific workflows to update orders', 403);
      } else if (profile!.role === 'restaurant') {
        if (saved.restaurant !== profile!.businessName)
          return error('This order belongs to another restaurant', 403);
        const transitions: Record<string, string> = {
          placed: 'accepted',
          accepted: 'preparing',
          preparing: 'ready',
        };
        if (transitions[saved.status] !== input.status)
          return error('Invalid restaurant order transition', 409);
        patch = { status: input.status };
      } else if (profile!.role === 'driver') {
        if (saved.status === 'ready' && input.status === 'picked_up' && !saved.driverId) {
          patch = { status: 'picked_up', driverId: user!.userId, driverName: profile!.fullName };
        } else if (saved.status === 'picked_up' && saved.driverId === user!.userId && input.status === 'delivered') {
          patch = { status: 'delivered' };
        } else {
          return error('This delivery is no longer available to you', 409);
        }
      } else {
        return error('Customers cannot update order status', 403);
      }
      const [updated] = await db.tx.update('flavourly_orders', [{
        id: params.id,
        record: patch,
        if: { status: saved.status, ...(saved.driverId ? { driverId: saved.driverId } : { driverId: undefined }) },
      }], { patch: true });
      if (!updated) return error('Order changed; refresh and try again', 409);
      const [fresh] = await db.get<OrderRecord>('flavourly_orders', [params.id], { consistent: true });
      return json({ order: { ...fresh, id: params.id } });
    },
  ],
});
