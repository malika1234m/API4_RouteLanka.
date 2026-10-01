import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signatureOk } from "./whatsapp";

const SECRET = "test-app-secret";
const sign = (raw: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;

describe("webhook signature (X-Hub-Signature-256)", () => {
  const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [] }] });
  it("accepts a body signed with the app secret", () => {
    expect(signatureOk(raw, sign(raw), SECRET)).toBe(true);
  });
  it("rejects a wrong secret, a changed body, a missing or malformed header", () => {
    expect(signatureOk(raw, sign(raw, "someone-else"), SECRET)).toBe(false);
    expect(signatureOk(raw.replace("1", "2"), sign(raw), SECRET)).toBe(false);
    expect(signatureOk(raw, undefined, SECRET)).toBe(false);
    expect(signatureOk(raw, "md5=abc", SECRET)).toBe(false);
    expect(signatureOk(raw, "sha256=short", SECRET)).toBe(false);
  });
  it("checks the exact bytes received (re-serialised JSON would not match)", () => {
    const spaced = JSON.stringify(JSON.parse(raw), null, 2);
    expect(signatureOk(spaced, sign(raw), SECRET)).toBe(false);
  });
});
