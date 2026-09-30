const env = (k: string, fallback?: string): string => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`Missing environment variable ${k}`);
  return v;
};

const DEV_SECRETS = ["dev-only-secret-change-me-in-production-please", "change-me-to-a-long-random-string", "dev-sms-token"];

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
  instanceId: env("HOSTNAME", `api-${process.pid}`),
};

// Never run a production deployment on the development secrets.
if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_SECRETS !== "true") {
  for (const [name, value] of [["SESSION_SECRET", config.sessionSecret], ["SMS_GATEWAY_TOKEN", config.smsGatewayToken]] as const)
    if (DEV_SECRETS.includes(value) || value.length < 12) throw new Error(`${name} must be set to a long random value in production`);
}
