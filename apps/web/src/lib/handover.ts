/**
 * The store's handover code for an order: four digits the driver enters as proof of delivery.
 * It is derived from the order, so the driver's phone can check it with no signal. In production
 * the codes would be issued with the published plan and stored hashed on the phone.
 */
export function handoverCode(ref: string): string {
  let h = 2166136261;
  for (const c of `${ref}|routelanka`) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return String((h >>> 0) % 10000).padStart(4, "0");
}
