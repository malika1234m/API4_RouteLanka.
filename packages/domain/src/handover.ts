/**
 * Handover codes: proof of delivery that works with no signal.
 *
 * When the plan is published, the API draws a random 4-digit code for each order. The store sees the
 * code (on WhatsApp and in the app). The driver's phone receives only a salted hash of each code with
 * its run, so it can check the code the store reads out without a connection, and a driver cannot read
 * the codes off the phone. FNV-1a is enough here: the code only has to resist casual guessing on a
 * doorstep, and every delivery is still recorded and confirmed by the store.
 */
export function fnv1a(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export const codeHash = (orderRef: string, code: string): string => fnv1a(`${orderRef}|${code}|routelanka-handover`);

export const codeMatches = (orderRef: string, code: string, hash?: string): boolean => !!hash && codeHash(orderRef, code) === hash;
