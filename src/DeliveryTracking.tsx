import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "./client";
import { Fix, Pin, validPin, freshFix, fixPayload } from "./tracking";
import "./DeliveryTracking.css";
type Props = {
  order: { id: string; status: string; destination?: Pin };
  role: string;
};
export default function DeliveryTracking({ order, role }: Props) {
  const [fix, setFix] = useState<Fix | null>(null),
    [sharing, setSharing] = useState(false),
    [message, setMessage] = useState(""),
    [now, setNow] = useState(Date.now()),
    [route, setRoute] = useState<any>(null),
    [routing, setRouting] = useState(false);
  const holder = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    layers = useRef<L.LayerGroup | null>(null),
    watch = useRef<number | null>(null),
    last = useRef(0),
    sending = useRef(false),
    stopped = useRef(true),
    generation = useRef(0);
  const active = order.status === "picked_up";
  const read = async () => {
    try {
      const r = await api.get("/api/orders/" + order.id + "/location");
      setFix(r.data.location || null);
    } catch {
      setMessage(
        "Driver location could not refresh. Do not rely on an old marker.",
      );
    }
  };
  useEffect(() => {
    setFix(null);
    setRoute(null);
    read();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") read();
    }, 10000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      clearInterval(clock);
    };
  }, [order.id]);
  const clearWatch = () => {
    stopped.current = true;
    generation.current++;
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    setSharing(false);
  };
  const stop = async () => {
    clearWatch();
    await sendingStop();
  };
  const sendingStop = async () => {
    try {
      await api.put("/api/orders/" + order.id + "/location", {
        sharing: false,
      });
      setFix(null);
      setMessage("Location sharing stopped.");
    } catch {
      setMessage(
        "GPS stopped on this device. Server stop not confirmed; last marker becomes stale in 30 seconds.",
      );
    }
  };
  useEffect(() => {
    if (!active) {
      clearWatch();
      setFix(null);
      setRoute(null);
    }
    return () => {
      clearWatch();
      if (role === "driver") sendingStop();
    };
  }, [order.id, active]);
  useEffect(() => {
    if (!holder.current) return;
    const m = L.map(holder.current, { scrollWheelZoom: false }).setView(
      [-26.2041, 28.0473],
      12,
    );
    map.current = m;
    L.tileLayer(
      import.meta.env.VITE_MAP_TILE_URL ||
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 18,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      },
    )
      .on("tileerror", () =>
        setMessage(
          "Map tiles could not load. GPS sharing is separate from the map image.",
        ),
      )
      .addTo(m);
    layers.current = L.layerGroup().addTo(m);
    return () => {
      m.remove();
      map.current = null;
    };
  }, [order.id]);
  useEffect(() => {
    const g = layers.current,
      m = map.current;
    if (!g || !m) return;
    g.clearLayers();
    const points: L.LatLngExpression[] = [];
    if (validPin(order.destination)) {
      L.circleMarker([order.destination.lat, order.destination.lng], {
        radius: 9,
        color: "#181818",
        fillOpacity: 1,
      })
        .bindTooltip("Delivery pin")
        .addTo(g);
      points.push([order.destination.lat, order.destination.lng]);
    }
    if (freshFix(fix, now)) {
      L.circleMarker([fix!.lat, fix!.lng], {
        radius: 9,
        color: "#106e55",
        fillOpacity: 1,
      })
        .bindTooltip("Driver GPS")
        .addTo(g);
      L.circle([fix!.lat, fix!.lng], {
        radius: Math.min(fix!.accuracy, 1000),
        color: "#106e55",
        weight: 1,
      }).addTo(g);
      points.push([fix!.lat, fix!.lng]);
    }
    if (route && freshFix(fix, now)) {
      L.geoJSON(route.geometry, {
        style: { color: "#c58a00", weight: 5 },
      }).addTo(g);
    }
    if (points.length)
      m.fitBounds(L.latLngBounds(points), { padding: [35, 35], maxZoom: 16 });
  }, [fix, order.destination, route, Math.floor(now / 5000)]);
  const start = () => {
    if (watch.current !== null) return;
    if (!navigator.geolocation) {
      setMessage("GPS is unavailable in this browser.");
      return;
    }
    stopped.current = false;
    const token = ++generation.current;
    setMessage("Allow location access in your browser. Keep this page open.");
    watch.current = navigator.geolocation.watchPosition(
      async (p) => {
        if (stopped.current || token !== generation.current) return;
        const payload = fixPayload(p);
        if (
          !validPin(payload) ||
          !Number.isFinite(payload.accuracy) ||
          payload.accuracy > 250
        ) {
          setMessage(
            "GPS accuracy is too low. Move somewhere with a clearer signal.",
          );
          return;
        }
        if (Date.now() - last.current < 10000 || sending.current) return;
        last.current = Date.now();
        sending.current = true;
        try {
          await api.put("/api/orders/" + order.id + "/location", {
            ...payload,
            sharing: true,
          });
          if (!stopped.current && token === generation.current) {
            setFix({ ...payload, updatedAt: Date.now(), sharing: true });
            setSharing(true);
            setMessage(
              "Sharing GPS for this delivery only. Keep the page open.",
            );
          } else await sendingStop();
        } catch {
          setMessage(
            "GPS was read, but upload failed. Customer position is not updating.",
          );
        } finally {
          sending.current = false;
        }
      },
      (e) => {
        clearWatch();
        setMessage(
          e.code === 1
            ? "Location permission denied. Enable it in browser settings to share."
            : "GPS unavailable or timed out. No position was invented.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };
  const directions = async () => {
    if (!freshFix(fix) || !validPin(order.destination)) return;
    setRouting(true);
    setRoute(null);
    try {
      const a = fix!,
        b = order.destination!;
      const endpoint = import.meta.env.VITE_ROUTING_URL;
      if (!endpoint) throw Error();
      const r = await fetch(
        endpoint +
          "/route/v1/driving/" +
          a.lng +
          "," +
          a.lat +
          ";" +
          b.lng +
          "," +
          b.lat +
          "?overview=full&geometries=geojson&steps=true",
        { signal: AbortSignal.timeout(15000) },
      );
      const j = await r.json();
      if (!r.ok || j.code !== "Ok" || !j.routes?.[0]) throw Error();
      setRoute(j.routes[0]);
      setMessage(
        "Road route loaded. Follow road signs and local rules, not this preview alone.",
      );
    } catch {
      setMessage(
        "Road routing is unavailable. No straight-line route was substituted.",
      );
    } finally {
      setRouting(false);
    }
  };
  return (
    <section className="tracking-panel" aria-label="Delivery GPS tracking">
      <h2>
        {role === "driver" ? "GPS & road navigation" : "Track your delivery"}
      </h2>
      <p>
        {!active
          ? "Tracking is available after driver pickup."
          : freshFix(fix, now)
            ? "Driver GPS updated " +
              Math.max(0, Math.floor((now - fix!.updatedAt) / 1000)) +
              "s ago · ±" +
              Math.round(fix!.accuracy) +
              "m"
            : "No fresh driver GPS. Location unavailable or stale."}
      </p>
      <div
        ref={holder}
        className="tracking-map"
        aria-label="Driver and delivery map"
      />
      {!validPin(order.destination) && (
        <p>
          Delivery pin is missing. The customer must confirm a pin at checkout;
          an address alone is not routed.
        </p>
      )}
      {role === "driver" && active && (
        <>
          <p>
            Share your position with this order's customer and restaurant. Stops
            on completion. Browsers can pause GPS in the background; keep the
            page open.
          </p>
          <button className="gps-button" disabled={sharing} onClick={start}>
            Start sharing GPS
          </button>
          <button
            className="gps-button secondary"
            disabled={!sharing && watch.current === null}
            onClick={stop}
          >
            Stop sharing
          </button>
          {validPin(order.destination) && (
            <a
              className="gps-button"
              target="_blank"
              rel="noopener noreferrer"
              href={
                "https://www.google.com/maps/dir/?" +
                new URLSearchParams({
                  api: "1",
                  destination:
                    order.destination!.lat + "," + order.destination!.lng,
                  travelmode: "driving",
                  dir_action: "navigate",
                }).toString()
              }
            >
              Open Google Maps navigation
            </a>
          )}
          <small>
            Navigation opens Google Maps and shares the delivery pin with
            Google. Returning to ZINGO may be needed to resume GPS if your phone
            pauses this page.
          </small>
          {import.meta.env.VITE_ROUTING_URL && (
            <>
              <button
                className="gps-button"
                disabled={
                  !freshFix(fix, now) || !validPin(order.destination) || routing
                }
                onClick={directions}
              >
                {routing ? "Finding road route…" : "Show in-app road route"}
              </button>
              <small>
                In-app routing sends coordinates to the configured routing
                provider.
              </small>
            </>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
      {route && freshFix(fix, now) && (
        <div>
          <strong>
            {(route.distance / 1000).toFixed(1)} km ·{" "}
            {Math.ceil(route.duration / 60)} min estimate
          </strong>
          <ol>
            {route.legs
              .flatMap((l: any) => l.steps)
              .slice(0, 30)
              .map((s: any, i: number) => (
                <li key={i}>
                  {s.maneuver.type.replaceAll("_", " ")}{" "}
                  {s.maneuver.modifier || ""}
                  {s.name ? " onto " + s.name : ""} · {Math.round(s.distance)}m
                </li>
              ))}
          </ol>
        </div>
      )}
    </section>
  );
}
