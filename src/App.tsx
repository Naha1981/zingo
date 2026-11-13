import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ws } from '@appdeploy/client';
import AdminApplications from './AdminApplications';
import {
  ArrowLeft,
  ArrowRight,
  Bike,
  Check,
  ChefHat,
  ChevronDown,
  Clock3,
  Compass,
  Heart,
  Home,
  MapPin,
  MessageCircle,
  Minus,
  Navigation,
  Package,
  Phone,
  Plus,
  Search,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Star,
  Store,
  Wallet,
  X,
  Zap,
  CircleUserRound,
  ClipboardList,
  TrendingUp,
  ShieldCheck,
} from 'lucide-react';

type OrderStatus =
  | 'placed'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'picked_up'
  | 'delivered';
type Order = {
  id: string;
  customerName: string;
  restaurant: string;
  items: { name: string; qty: number; price: number }[];
  foodSubtotal: number;
  deliveryFee: number;
  total: number;
  restaurantPayout: number;
  driverPayout: number;
  nahaLabsRevenue: number;
  address: string;
  status: OrderStatus;
  driverName?: string;
  createdAt: number;
};

const menu = [
  {
    id: 'm1',
    name: 'Double Smash Burger',
    description: 'Two smashed beef patties, cheddar, pickles and house sauce',
    price: 89,
    category: 'Burgers',
    rating: 4.9,
    time: '20–30 min',
    image:
      'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=900&q=85',
  },
  {
    id: 'm2',
    name: 'Margherita Pizza',
    description: 'Mozzarella, basil, tomato and a crisp stone-baked base',
    price: 105,
    category: 'Pizza',
    rating: 4.8,
    time: '25–35 min',
    image:
      'https://images.unsplash.com/photo-1579751626657-72bc17010498?w=900&q=85',
  },
  {
    id: 'm3',
    name: 'Crispy Chicken Bowl',
    description: 'Golden chicken, greens, avocado and creamy dressing',
    price: 96,
    category: 'Chicken',
    rating: 4.9,
    time: '20–30 min',
    image:
      'https://images.unsplash.com/photo-1547592180-85f173990554?w=900&q=85',
  },
  {
    id: 'm4',
    name: 'Loaded Chips',
    description: 'Crispy chips with cheese sauce and jalapeño',
    price: 48,
    category: 'Sides',
    rating: 4.7,
    time: '15–20 min',
    image:
      'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=900&q=85',
  },
  {
    id: 'm5',
    name: 'Classic Cheeseburger',
    description: 'Grilled beef, cheddar, lettuce and tomato',
    price: 76,
    category: 'Burgers',
    rating: 4.8,
    time: '20–30 min',
    image:
      'https://images.unsplash.com/photo-1550547660-d9450f859349?w=900&q=85',
  },
  {
    id: 'm6',
    name: 'Pepperoni Pizza',
    description: 'Mozzarella, pepperoni and rich tomato sauce',
    price: 119,
    category: 'Pizza',
    rating: 4.9,
    time: '25–35 min',
    image:
      'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=900&q=85',
  },
];

const restaurants = [
  {
    id: 'r1',
    name: 'The Local Kitchen',
    cuisine: 'Burgers · Pizza · Comfort food',
    rating: 4.9,
    time: '20–30 min',
    delivery: 'R35 delivery',
    image:
      'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=900&q=85',
    tag: 'Popular near you',
  },
  {
    id: 'r2',
    name: 'Fire & Flour',
    cuisine: 'Wood-fired pizza · Italian',
    rating: 4.8,
    time: '25–35 min',
    delivery: 'R35 delivery',
    image:
      'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=900&q=85',
    tag: 'Local favourite',
  },
  {
    id: 'r3',
    name: 'Green Bowl Co.',
    cuisine: 'Fresh · Healthy · Bowls',
    rating: 4.7,
    time: '15–25 min',
    delivery: 'R35 delivery',
    image:
      'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=900&q=85',
    tag: 'Fresh picks',
  },
];

const money = (n: number) => 'R' + n.toFixed(2);
const statusLabel: Record<OrderStatus, string> = {
  placed: 'New order',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready for pickup',
  picked_up: 'On the way',
  delivered: 'Delivered',
};
const nextStatus: Partial<Record<OrderStatus, OrderStatus>> = {
  placed: 'accepted',
  accepted: 'preparing',
  preparing: 'ready',
  ready: 'picked_up',
  picked_up: 'delivered',
};

function allocation(food: number, delivery: number) {
  const restaurant = Math.round(food * 0.92 * 100) / 100;
  const nahaLabs =
    Math.round((food * 0.08 + Math.min(3, delivery)) * 100) / 100;
  const driver = Math.round((delivery - Math.min(3, delivery)) * 100) / 100;
  return { restaurant, driver, nahaLabs };
}

export default function App({ role, onSignOut }: { role: 'customer' | 'restaurant' | 'driver' | 'admin'; onSignOut: () => void }) {
  const [view, setView] = useState<
    'customer' | 'restaurant' | 'driver' | 'admin'
  >(role);
  const [cart, setCart] = useState<
    { item: (typeof menu)[number]; qty: number }[]
  >([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [selectedRestaurant, setSelectedRestaurant] = useState(restaurants[0]);
  const [showCart, setShowCart] = useState(false);
  const [address, setAddress] = useState('Home · 12 Main Road, Johannesburg');
  const [customerName, setCustomerName] = useState('Guest');
  const [notice, setNotice] = useState('');
  const [activeOrder, setActiveOrder] = useState<string | null>(null);
  const connection = useRef<ReturnType<typeof ws.connect> | null>(null);

  const refreshOrders = async () => {
    try {
      const result = await api.get('/api/orders');
      setOrders(result.data.orders || []);
    } catch {
      setNotice('Could not load orders. Please refresh.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshOrders();
    const conn = ws.connect();
    connection.current = conn;
    conn.onMessage((message: any) => {
      if (
        message?.type === 'entity.update' &&
        message?.payload?.entity_type === 'orders'
      ) {
        const updated = message.payload.data as Order;
        setOrders(current => {
          const exists = current.some(order => order.id === updated.id);
          return exists
            ? current.map(order => (order.id === updated.id ? updated : order))
            : [updated, ...current];
        });
      }
    });
    conn.ready
      .then(() => {
        if (conn.connectionId) {
          api
            .post('/api/subscriptions', {
              entity_type: 'orders',
              entity_id: 'all',
              connection_id: conn.connectionId,
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      if (conn.connectionId)
        api
          .post('/api/subscriptions/remove', {
            entity_type: 'orders',
            entity_id: 'all',
            connection_id: conn.connectionId,
          })
          .catch(() => {});
      conn.disconnect();
      connection.current = null;
    };
  }, []);

  const cartCount = cart.reduce((sum, row) => sum + row.qty, 0);
  const foodSubtotal = cart.reduce(
    (sum, row) => sum + row.item.price * row.qty,
    0
  );
  const deliveryFee = 35;
  const totals = allocation(foodSubtotal, deliveryFee);
  const total = foodSubtotal + deliveryFee;
  const filteredMenu = menu.filter(
    item =>
      (category === 'All' || item.category === category) &&
      (item.name.toLowerCase().includes(search.toLowerCase()) ||
        item.description.toLowerCase().includes(search.toLowerCase()))
  );

  const addItem = (item: (typeof menu)[number]) => {
    setCart(current => {
      const found = current.find(row => row.item.id === item.id);
      return found
        ? current.map(row =>
            row.item.id === item.id ? { ...row, qty: row.qty + 1 } : row
          )
        : [...current, { item, qty: 1 }];
    });
  };
  const changeQty = (id: string, amount: number) =>
    setCart(current =>
      current
        .map(row =>
          row.item.id === id ? { ...row, qty: row.qty + amount } : row
        )
        .filter(row => row.qty > 0)
    );

  const placeOrder = async () => {
    if (!cart.length || !address.trim()) return;
    setBusy(true);
    try {
      const result = await api.post('/api/orders', {
        customerName,
        restaurant: selectedRestaurant.name,
        items: cart.map(row => ({
          name: row.item.name,
          qty: row.qty,
          price: row.item.price,
        })),
        foodSubtotal,
        deliveryFee,
        total,
        ...totals,
        address,
      });
      setOrders(current => [
        result.data.order,
        ...current.filter(order => order.id !== result.data.order.id),
      ]);
      setActiveOrder(result.data.order.id);
      setCart([]);
      setShowCart(false);
      setNotice('Order placed! Your restaurant has been notified.');
      setView('customer');
    } catch {
      setNotice('Order could not be placed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const updateOrder = async (
    order: Order,
    status: OrderStatus,
    driverName?: string
  ) => {
    setBusy(true);
    try {
      const result = await api.put('/api/orders/' + order.id, {
        status,
        driverName,
      });
      setOrders(current =>
        current.map(row => (row.id === order.id ? result.data.order : row))
      );
      setNotice(
        status === 'delivered'
          ? 'Delivery completed. Earnings recorded in the demo ledger.'
          : 'Order updated.'
      );
    } catch {
      setNotice('Could not update order. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const currentOrder =
    orders.find(order => order.id === activeOrder) || orders[0];
  const openOrders = orders.filter(order => order.status !== 'delivered');
  const completedOrders = orders.filter(order => order.status === 'delivered');

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => setView(role)}
          aria-label="ZINGO home"
        >
          <span className="brand-mark"><Zap size={22} fill="currentColor" strokeWidth={2.5} /></span>
          <span>ZINGO</span>
        </button>
        <div className="location-pill">
          <MapPin size={15} />
          <span>Johannesburg, Gauteng</span>
          <ChevronDown size={14} />
        </div>
        <div className="top-actions">
          {role === 'customer' && <button className="icon-btn" onClick={() => setShowCart(true)} aria-label="Open cart"><ShoppingBag size={19} />{cartCount > 0 && <i>{cartCount}</i>}</button>}
          <button className="avatar-btn" onClick={onSignOut} aria-label="Sign out"><CircleUserRound size={19} /></button>
        </div>
      </header>

      <nav className="role-nav" aria-label="App areas">
        {[
          { id: 'customer', label: 'Order food', icon: <Home size={16} /> },
          { id: 'restaurant', label: 'Restaurant', icon: <Store size={16} /> },
          { id: 'driver', label: 'Driver', icon: <Bike size={16} /> },
          { id: 'admin', label: 'ZINGO Ops', icon: <ClipboardList size={16} /> },
        ].filter(item => item.id === role).map(item => (
          <button
            key={item.id}
            className={view === item.id ? 'role-tab active' : 'role-tab'}
            onClick={() => {
              setView(item.id as typeof view);
              setShowCart(false);
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
          <button onClick={() => setNotice('')}>
            <X size={14} />
          </button>
        </div>
      )}

      {view === 'customer' && (
        <main className="customer-layout">
          <section className="customer-hero">
            <div className="hero-copy">
              <div className="eyebrow">
                <Zap size={14} /> GOOD FOOD. BETTER LOCAL.
              </div>
              <h1>
                What are you
                <br />
                going to eat today?
              </h1>
              <p>
                Discover neighbourhood favourites, delivered by local drivers.
              </p>
              <div className="searchbar">
                <Search size={19} />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search dishes and favourites..."
                />
                <button onClick={() => setCategory('All')}>
                  <SlidersHorizontal size={16} /> Filter
                </button>
              </div>
            </div>
            <div className="hero-art">
              <img
                src="https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=1200&q=85"
                alt="Freshly prepared food"
              />
              <div className="hero-sticker">
                <span>LOCAL</span>
                <strong>
                  tastes
                  <br />
                  better.
                </strong>
              </div>
            </div>
          </section>

          <section className="offer-strip">
            <div>
              <span className="eyebrow">A BETTER WAY TO ORDER</span>
              <h2>Good food. Fairer delivery.</h2>
              <p>
                More value stays with the restaurants and drivers who make it
                happen.
              </p>
            </div>
            <div className="offer-bubble">
              Made for
              <br />
              <b>local food</b>
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading">
              <div>
                <span className="eyebrow">FIND YOUR FAVOURITE</span>
                <h2>Explore categories</h2>
              </div>
              <span className="muted">Fresh picks around Johannesburg</span>
            </div>
            <div className="category-row">
              {['All', 'Burgers', 'Pizza', 'Chicken', 'Sides'].map(
                (name, index) => (
                  <button
                    key={name}
                    className={
                      category === name
                        ? 'category-chip selected'
                        : 'category-chip'
                    }
                    onClick={() => setCategory(name)}
                  >
                    <span>{['✦', '🍔', '🍕', '🍗', '🍟'][index]}</span>
                    {name}
                  </button>
                )
              )}
            </div>
          </section>

          <section className="section-block">
            <div className="section-heading">
              <div>
                <span className="eyebrow">NEAR YOU</span>
                <h2>Local favourites</h2>
              </div>
              <button className="text-link" onClick={() => setCategory('All')}>
                See all <ArrowRight size={15} />
              </button>
            </div>
            <div className="restaurant-grid">
              {restaurants.map(restaurant => (
                <button
                  className={
                    selectedRestaurant.id === restaurant.id
                      ? 'restaurant-card chosen'
                      : 'restaurant-card'
                  }
                  key={restaurant.id}
                  onClick={() => setSelectedRestaurant(restaurant)}
                >
                  <div className="restaurant-photo">
                    <img src={restaurant.image} alt={restaurant.name} />
                    <span>{restaurant.tag}</span>
                    <Heart size={18} />
                  </div>
                  <div className="restaurant-info">
                    <div>
                      <h3>{restaurant.name}</h3>
                      <p>{restaurant.cuisine}</p>
                    </div>
                    <div className="restaurant-meta">
                      <span>
                        <Star size={14} fill="currentColor" />
                        {restaurant.rating}
                      </span>
                      <span>
                        <Clock3 size={14} />
                        {restaurant.time}
                      </span>
                    </div>
                    <small>
                      {restaurant.delivery} · Selected:{' '}
                      {selectedRestaurant.id === restaurant.id
                        ? 'Yes'
                        : 'Choose restaurant'}
                    </small>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="section-block menu-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">THE LOCAL KITCHEN MENU</span>
                <h2>Popular right now</h2>
              </div>
              <span className="muted">
                Ordering from {selectedRestaurant.name}
              </span>
            </div>
            <div className="menu-grid">
              {filteredMenu.map(item => (
                <article className="menu-card" key={item.id}>
                  <div className="menu-photo">
                    <img src={item.image} alt={item.name} />
                    <span>
                      <Star size={12} fill="currentColor" />
                      {item.rating}
                    </span>
                  </div>
                  <div className="menu-info">
                    <div>
                      <h3>{item.name}</h3>
                      <p>{item.description}</p>
                    </div>
                    <div className="menu-bottom">
                      <strong>{money(item.price)}</strong>
                      <button
                        className="add-button"
                        onClick={() => addItem(item)}
                        aria-label={'Add ' + item.name}
                      >
                        <Plus size={17} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
              {filteredMenu.length === 0 && (
                <div className="empty-state">
                  No dishes match that search. Try another category.
                </div>
              )}
            </div>
          </section>
        </main>
      )}

      {view === 'restaurant' && (
        <main className="workspace">
          <div className="workspace-heading">
            <div>
              <span className="eyebrow">MERCHANT WORKSPACE</span>
              <h1>Good afternoon, Local Kitchen.</h1>
              <p>
                Manage orders, prepare meals and keep your customers updated.
              </p>
            </div>
            <span className="live-pill">
              <i /> Demo workspace
            </span>
          </div>
          <div className="metric-row">
            <Metric
              label="Open orders"
              value={String(openOrders.length)}
              icon={<Package />}
            />
            <Metric
              label="Completed today"
              value={String(completedOrders.length)}
              icon={<Check />}
            />
            <Metric
              label="Food sales"
              value={money(
                orders.reduce((sum, order) => sum + order.foodSubtotal, 0)
              )}
              icon={<TrendingUp />}
            />
            <Metric
              label="Restaurant payout"
              value={money(
                orders.reduce((sum, order) => sum + order.restaurantPayout, 0)
              )}
              icon={<Wallet />}
            />
          </div>
          <div className="workspace-panel">
            <div className="panel-title">
              <div>
                <h2>Incoming orders</h2>
                <p>
                  New customer orders appear here and update across workspaces.
                </p>
              </div>
              <span className="count-pill">{openOrders.length} active</span>
            </div>
            {orders.length === 0 ? (
              <EmptyOrders
                title="No orders yet"
                text="Place a demo order in the customer app to see the restaurant workflow."
              />
            ) : (
              <div className="order-list">
                {orders.map(order => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    action={
                      nextStatus[order.status]
                        ? () => updateOrder(order, nextStatus[order.status]!)
                        : undefined
                    }
                    actionLabel={
                      nextStatus[order.status]
                        ? (
                            {
                              placed: 'Accept order',
                              accepted: 'Start preparing',
                              preparing: 'Mark ready',
                              ready: 'Handed to driver',
                              picked_up: 'Mark delivered',
                            } as Record<string, string>
                          )[order.status]
                        : 'Completed'
                    }
                    busy={busy}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
      )}

      {view === 'driver' && (
        <main className="driver-layout">
          <div className="workspace-heading">
            <div>
              <span className="eyebrow">DRIVER WORKSPACE</span>
              <h1>Your deliveries</h1>
              <p>
                Choose local delivery work with clear earnings before you
                accept.
              </p>
            </div>
            <span className="availability">
              <i /> Available for deliveries
            </span>
          </div>
          <div className="driver-summary">
            <div>
              <span className="eyebrow">TODAY'S DEMO EARNINGS</span>
              <strong>
                {money(
                  orders
                    .filter(order => order.status === 'delivered')
                    .reduce((sum, order) => sum + order.driverPayout, 0)
                )}
              </strong>
              <small>{completedOrders.length} completed deliveries</small>
            </div>
            <div className="driver-summary-icon">
              <Bike size={27} />
            </div>
          </div>
          <div className="driver-columns">
            <section className="workspace-panel">
              <div className="panel-title">
                <div>
                  <h2>Delivery offers</h2>
                  <p>See the route and payout before accepting.</p>
                </div>
                <span className="count-pill">
                  {
                    openOrders.filter(
                      order =>
                        order.status === 'ready' || order.status === 'placed'
                    ).length
                  }{' '}
                  available
                </span>
              </div>
              {orders.length === 0 ? (
                <EmptyOrders
                  title="No delivery offers yet"
                  text="New restaurant orders will appear here once placed."
                />
              ) : (
                <div className="order-list">
                  {orders
                    .filter(order => order.status !== 'delivered')
                    .map(order => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        action={
                          order.status === 'ready'
                            ? () =>
                                updateOrder(order, 'picked_up', 'Local driver')
                            : order.status === 'picked_up'
                              ? () =>
                                  updateOrder(
                                    order,
                                    'delivered',
                                    'Local driver'
                                  )
                              : undefined
                        }
                        actionLabel={
                          order.status === 'ready'
                            ? 'Accept & pick up'
                            : order.status === 'picked_up'
                              ? 'Confirm delivered'
                              : 'Waiting for restaurant'
                        }
                        busy={busy}
                      />
                    ))}
                </div>
              )}
            </section>
            <section className="workspace-panel map-panel">
              <div className="panel-title">
                <div>
                  <h2>Delivery area</h2>
                  <p>Illustrative Johannesburg route view</p>
                </div>
                <Navigation size={18} />
              </div>
              <div className="map-illustration">
                <div className="map-roads" />
                <span className="map-home">
                  <Home size={18} />
                </span>
                <span className="map-pin pin-one">1</span>
                <span className="map-pin pin-two">2</span>
                <span className="map-pin pin-three">3</span>
                <svg viewBox="0 0 400 260" preserveAspectRatio="none">
                  <path
                    d="M48 120 C90 130 115 205 170 180 S245 105 290 130 S335 70 360 45"
                    fill="none"
                    stroke="#239bc5"
                    strokeWidth="4"
                    strokeDasharray="7 7"
                  />
                </svg>
                <span className="map-caption">
                  Johannesburg · route preview
                </span>
              </div>
              <div className="map-legend">
                <span>
                  <i /> Restaurant pickup
                </span>
                <span>
                  <i /> Customer drop-off
                </span>
              </div>
            </section>
          </div>
        </main>
      )}

      {view === 'admin' && (
        <main className="workspace">
          <div className="workspace-heading">
            <div>
              <span className="eyebrow">ZINGO OPERATIONS</span>
              <h1>Marketplace overview</h1>
              <p>Monitor orders, proposed payouts and platform revenue.</p>
            </div>
            <span className="test-pill">
              <ShieldCheck size={15} /> TEST MODE · NO LIVE PAYMENTS
            </span>
          </div>
          <AdminApplications />
          <div className="metric-row">
            <Metric
              label="Total orders"
              value={String(orders.length)}
              icon={<ClipboardList />}
            />
            <Metric
              label="Food GMV"
              value={money(
                orders.reduce((sum, order) => sum + order.foodSubtotal, 0)
              )}
              icon={<ShoppingCart />}
            />
            <Metric
              label="Restaurant payouts"
              value={money(
                orders.reduce((sum, order) => sum + order.restaurantPayout, 0)
              )}
              icon={<Store />}
            />
            <Metric
              label="ZINGO platform gross"
              value={money(
                orders.reduce((sum, order) => sum + order.nahaLabsRevenue, 0)
              )}
              icon={<Wallet />}
            />
          </div>
          <div className="admin-grid">
            <section className="workspace-panel">
              <div className="panel-title">
                <div>
                  <h2>Transaction model</h2>
                  <p>Agreed example allocation for R100 food + R35 delivery.</p>
                </div>
                <span className="test-pill">Illustrative</span>
              </div>
              <div className="split-rows">
                <Split
                  label="Restaurant"
                  amount="R92.00"
                  percent="68.15%"
                  color="green"
                />
                <Split
                  label="Driver"
                  amount="R32.00"
                  percent="23.70%"
                  color="blue"
                />
                <Split
                  label="ZINGO"
                  amount="R11.00"
                  percent="8.15%"
                  color="gold"
                />
              </div>
              <div className="allocation-note">
                <strong>R135.00 total customer payment</strong>
                <span>
                  Processing fees, refunds and chargebacks are not included.
                  Paystack marketplace approval is pending.
                </span>
              </div>
            </section>
            <section className="workspace-panel">
              <div className="panel-title">
                <div>
                  <h2>Payment readiness</h2>
                  <p>Provider setup status</p>
                </div>
                <span className="pending-pill">Awaiting review</span>
              </div>
              <div className="readiness-row">
                <span className="status-dot pending" />
                Paystack compliance review
              </div>
              <div className="readiness-row">
                <span className="status-dot pending" />
                Three-party split approval
              </div>
              <div className="readiness-row">
                <span className="status-dot muted-dot" />
                Live payments disabled
              </div>
              <p className="fine-print">
                All checkouts in this prototype are simulated. No card details
                are collected and no money moves.
              </p>
            </section>
          </div>
          <section className="workspace-panel">
            <div className="panel-title">
              <div>
                <h2>Order ledger</h2>
                <p>
                  Persistent demo order records shared across all workspaces.
                </p>
              </div>
              <button className="refresh-button" onClick={refreshOrders}>
                <Compass size={15} /> Refresh
              </button>
            </div>
            {orders.length ? (
              <div className="order-list">
                {orders.map(order => (
                  <OrderCard key={order.id} order={order} busy={busy} />
                ))}
              </div>
            ) : (
              <EmptyOrders
                title="The ledger is empty"
                text="Create a customer order to start testing the end-to-end workflow."
              />
            )}
          </section>
        </main>
      )}

      {showCart && (
        <div className="drawer-backdrop" onClick={() => setShowCart(false)}>
          <aside
            className="cart-drawer"
            onClick={event => event.stopPropagation()}
          >
            <div className="drawer-heading">
              <div>
                <span className="eyebrow">YOUR ORDER</span>
                <h2>Your basket</h2>
              </div>
              <button className="icon-btn" onClick={() => setShowCart(false)}>
                <X size={18} />
              </button>
            </div>
            <label className="field-label">
              Delivery location
              <input
                value={address}
                onChange={event => setAddress(event.target.value)}
              />
            </label>
            <label className="field-label">
              Your name
              <input
                value={customerName}
                onChange={event => setCustomerName(event.target.value)}
              />
            </label>
            {cart.length === 0 ? (
              <EmptyOrders
                title="Your basket is empty"
                text="Add a dish from the menu to get started."
              />
            ) : (
              <div className="cart-lines">
                {cart.map(row => (
                  <div className="cart-line" key={row.item.id}>
                    <img src={row.item.image} alt="" />
                    <div className="cart-line-info">
                      <strong>{row.item.name}</strong>
                      <span>{money(row.item.price)} each</span>
                      <div className="qty-control">
                        <button onClick={() => changeQty(row.item.id, -1)}>
                          <Minus size={13} />
                        </button>
                        <b>{row.qty}</b>
                        <button onClick={() => changeQty(row.item.id, 1)}>
                          <Plus size={13} />
                        </button>
                      </div>
                    </div>
                    <strong>{money(row.item.price * row.qty)}</strong>
                  </div>
                ))}
              </div>
            )}
            <div className="checkout-summary">
              <div>
                <span>Food subtotal</span>
                <b>{money(foodSubtotal)}</b>
              </div>
              <div>
                <span>Delivery</span>
                <b>{money(cart.length ? deliveryFee : 0)}</b>
              </div>
              <div className="total-line">
                <span>Total</span>
                <strong>{money(cart.length ? total : 0)}</strong>
              </div>
              <div className="payout-hint">
                Restaurant {money(totals.restaurant)} · Driver{' '}
                {money(totals.driver)} · ZINGO {money(totals.nahaLabs)}
              </div>
            </div>
            <button
              className="checkout-button"
              disabled={!cart.length || busy || !address.trim()}
              onClick={placeOrder}
            >
              {busy ? 'Placing order…' : 'Place demo order · ' + money(total)}{' '}
              <ArrowRight size={17} />
            </button>
            <p className="fine-print">
              Demo checkout only. No payment will be taken.
            </p>
          </aside>
        </div>
      )}

      <footer className="footer">
        <span>
          ZINGO <b>·</b> Made for local food.
        </span>
        <span>Johannesburg pilot prototype · Payments in test mode</span>
      </footer>
      {loading && (
        <div className="loading-bar">Connecting to ZINGO marketplace…</div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="metric-card">
      <span className="metric-icon">{icon}</span>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function EmptyOrders({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Package size={22} />
      </span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
function OrderCard({
  order,
  action,
  actionLabel,
  busy,
}: {
  order: Order;
  action?: () => void;
  actionLabel?: string;
  busy: boolean;
}) {
  return (
    <article className="order-card">
      <div className="order-card-top">
        <div>
          <span className="order-id">
            ORDER #{order.id.slice(-6).toUpperCase()}
          </span>
          <h3>{order.restaurant}</h3>
        </div>
        <span className={'order-status status-' + order.status}>
          {statusLabel[order.status]}
        </span>
      </div>
      <div className="order-items">
        {order.items.map((item, index) => (
          <span key={index}>
            {item.qty} × {item.name}
          </span>
        ))}
      </div>
      <div className="order-card-meta">
        <span>
          <MapPin size={14} />
          {order.address}
        </span>
        <strong>{money(order.total)}</strong>
      </div>
      <div className="order-card-bottom">
        <span>
          Restaurant {money(order.restaurantPayout)} · Driver{' '}
          {money(order.driverPayout)}
        </span>
        {action && (
          <button className="small-action" disabled={busy} onClick={action}>
            {actionLabel}
            <ArrowRight size={14} />
          </button>
        )}
      </div>
    </article>
  );
}
function Split({
  label,
  amount,
  percent,
  color,
}: {
  label: string;
  amount: string;
  percent: string;
  color: string;
}) {
  return (
    <div className="split-row">
      <div>
        <strong>{label}</strong>
        <b>{amount}</b>
      </div>
      <div className="split-track">
        <i className={color} style={{ width: percent }} />
      </div>
    </div>
  );
}
