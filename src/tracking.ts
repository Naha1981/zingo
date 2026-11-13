export type Pin = { lat: number; lng: number };
export type Fix = Pin & {
  accuracy: number;
  updatedAt: number;
  sharing: boolean;
};
export const validPin = (p: any): p is Pin =>
  !!p &&
  typeof p.lat === "number" &&
  Number.isFinite(p.lat) &&
  Math.abs(p.lat) <= 90 &&
  typeof p.lng === "number" &&
  Number.isFinite(p.lng) &&
  Math.abs(p.lng) <= 180;
export const freshFix = (f: Fix | null, now = Date.now()) =>
  !!f && f.sharing && now - f.updatedAt < 30000 && now >= f.updatedAt;
export function fixPayload(p: GeolocationPosition) {
  return {
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    accuracy: p.coords.accuracy,
    capturedAt: p.timestamp,
  };
}
