/**
 * Public map positions of depots and district centres. The supplied data has no outlet
 * coordinates, so outlets are placed near their district centre: approximate, and labelled so.
 */
export type LatLng = [number, number];

export const DEPOT_POS: Record<string, LatLng> = {
  Peliyagoda: [6.9612, 79.8865],
  Kandy: [7.2566, 80.5966],
};

export const DISTRICT_POS: Record<string, LatLng> = {
  Colombo: [6.9022, 79.8612],
  Gampaha: [7.0873, 79.999],
  Kalutara: [6.5854, 79.9607],
  Galle: [6.0535, 80.221],
  Matara: [5.9549, 80.555],
  Kurunegala: [7.4818, 80.3609],
  Puttalam: [8.0362, 79.8283],
  Kandy: [7.2906, 80.6337],
  Matale: [7.4675, 80.6234],
  "Nuwara Eliya": [6.9497, 80.7891],
  Badulla: [6.9934, 81.055],
  Kegalle: [7.2513, 80.3464],
};

/** Typical distance between stops in each district, from the supplied district_travel data (km). */
const INTER_STOP_KM: Record<string, number> = { Colombo: 4, Gampaha: 7, Kalutara: 9, Galle: 10, Matara: 12, Kurunegala: 14, Puttalam: 18, Kandy: 3, Matale: 8, "Nuwara Eliya": 14, Badulla: 16, Kegalle: 10 };

/**
 * A stable spot for an outlet: around its district town, at a distance on the scale of that
 * district's typical inter-stop distance. Approximate by design: the data has no addresses.
 */
export function outletPos(outletId: string, district: string): LatLng {
  const c = DISTRICT_POS[district] ?? [7.3, 80.4];
  let h = 0;
  for (const ch of outletId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const ang = ((h % 360) * Math.PI) / 180;
  const km = (INTER_STOP_KM[district] ?? 8) * (0.35 + ((h >> 9) % 60) / 100);
  return [c[0] + (Math.sin(ang) * km) / 111, c[1] + (Math.cos(ang) * km) / (111 * Math.cos((c[0] * Math.PI) / 180))];
}

export const lerp = (a: LatLng, b: LatLng, f: number): LatLng => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
