export const basketKey = "zingo-preview-basket-v1";
export function readBasket<T extends { id: string }>(
  menu: T[],
): { item: T; qty: number }[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(basketKey) || "[]");
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    return v.slice(0, 20).flatMap((r: unknown) => {
      if (!r || typeof r !== "object") return [];
      const x = r as { id?: unknown; qty?: unknown };
      const item = menu.find((m) => m.id === x.id);
      if (
        !item ||
        seen.has(item.id) ||
        !Number.isInteger(x.qty) ||
        Number(x.qty) < 1 ||
        Number(x.qty) > 20
      )
        return [];
      seen.add(item.id);
      return [{ item, qty: Number(x.qty) }];
    });
  } catch {
    return [];
  }
}
export function saveBasket<T extends { id: string }>(
  rows: { item: T; qty: number }[],
) {
  try {
    sessionStorage.setItem(
      basketKey,
      JSON.stringify(rows.map((r) => ({ id: r.item.id, qty: r.qty }))),
    );
  } catch {}
}
export function clearBasket() {
  try {
    sessionStorage.removeItem(basketKey);
    sessionStorage.removeItem(basketKey + "-resume");
  } catch {}
}
export function resumeBasket(set = false) {
  try {
    if (set) {
      sessionStorage.setItem(basketKey + "-resume", "yes");
      return false;
    }
    const resume = sessionStorage.getItem(basketKey + "-resume") === "yes";
    return resume;
  } catch {
    return false;
  }
}
export function consumeResume() {
  try {
    sessionStorage.removeItem(basketKey + "-resume");
  } catch {}
}
