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
      const x = r as { id?: unknown; qty?: unknown; item?: any };
      let item = menu.find((m) => m.id === x.id);
      if (
        !item &&
        typeof x.id === "string" &&
        /^[a-f0-9-]{36}$/.test(x.id) &&
        x.item &&
        x.item.id === x.id &&
        typeof x.item.name === "string" &&
        x.item.name.length <= 80 &&
        typeof x.item.description === "string" &&
        x.item.description.length <= 240 &&
        ["Burgers", "Pizza", "Chicken", "Sides"].includes(x.item.category) &&
        typeof x.item.price === "number" &&
        Number.isFinite(x.item.price) &&
        x.item.price >= 1 &&
        x.item.price <= 10000
      ) {
        item = { ...x.item, image: "", rating: 0 } as T;
      }
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
      JSON.stringify(
        rows.map((r) => ({ id: r.item.id, qty: r.qty, item: r.item })),
      ),
    );
  } catch {}
}
export function clearBasket() {
  try {
    sessionStorage.removeItem(basketKey);
    sessionStorage.removeItem(basketKey + "-resume");
    sessionStorage.removeItem("zingo-preview-restaurant");
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
