const env = (k: string, fallback?: string): string => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`Missing environment variable ${k}`);
  return v;
};

const DEV_SECRETS = ["dev-only-secret-change-me-in-production-please", "change-me-to-a-long-random-string", "dev-sms-token", "dev-wa-app-secret", "dev-wa-verify-token"];

export const config = {
  port: Number(env("PORT", "4000")),
  databaseUrl: env("DATABASE_URL", "postgres://routelanka:routelanka@localhost:5433/routelanka"),
  rabbitUrl: env("RABBITMQ_URL", "amqp://routelanka:routelanka@localhost:5672/"),
  /** Signs session cookies. Set a long random value in production. */
  sessionSecret: env("SESSION_SECRET", "dev-only-secret-change-me-in-production-please"),
  /** Shared secret the SMS gateway puts on inbound messages. */
  smsGatewayToken: env("SMS_GATEWAY_TOKEN", "dev-sms-token"),
  /** Lets the demo deliver a driver's SMS without a phone network (see /api/sms/simulate). */
  smsSimulator: env("SMS_SIMULATOR", "true") === "true",
  cookieSecure: env("COOKIE_SECURE", "false") === "true",
  /** WhatsApp Business Platform: off, simulator (the bundled Cloud API simulator) or cloud (Meta). */
  whatsappMode: env("WHATSAPP_MODE", "off") as "off" | "simulator" | "cloud",
  /** The Meta app secret: every webhook is signed with it (X-Hub-Signature-256). */
  whatsappAppSecret: env("WHATSAPP_APP_SECRET", "dev-wa-app-secret"),
  /** Echoed back once when Meta verifies the webhook URL. */
  whatsappVerifyToken: env("WHATSAPP_VERIFY_TOKEN", "dev-wa-verify-token"),
  whatsappApiBase: env("WHATSAPP_API_BASE", "http://wa-sim:3200"),
  whatsappPhoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID", "100000000000001"),
  /** The business's WhatsApp number as people dial it (digits only): stores send their JOIN message here. */
  whatsappBusinessNumber: env("WHATSAPP_BUSINESS_NUMBER", "94110000000"),
  /** Where links in messages point (the report screen). */
  publicUrl: env("PUBLIC_URL", "http://localhost:3000"),
  instanceId: env("HOSTNAME", `api-${process.pid}`),
};

// Never run a production deployment on the development secrets.
if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_SECRETS !== "true") {
  const secrets: [string, string][] = [["SESSION_SECRET", config.sessionSecret], ["SMS_GATEWAY_TOKEN", config.smsGatewayToken]];
  if (config.whatsappMode === "cloud") secrets.push(["WHATSAPP_APP_SECRET", config.whatsappAppSecret], ["WHATSAPP_VERIFY_TOKEN", config.whatsappVerifyToken]);
  for (const [name, value] of secrets)
    if (DEV_SECRETS.includes(value) || value.length < 12) throw new Error(`${name} must be set to a long random value in production`);
}
