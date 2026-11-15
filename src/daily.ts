export const johannesburgDay = (time: number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time));
export function completedToday<
  T extends { status: string; deliveredAt?: number },
>(orders: T[], now = Date.now()): T[] {
  const day = johannesburgDay(now);
  return orders.filter(
    (o) =>
      o.status === "delivered" &&
      typeof o.deliveredAt === "number" &&
      Number.isFinite(o.deliveredAt) &&
      johannesburgDay(o.deliveredAt) === day,
  );
}
