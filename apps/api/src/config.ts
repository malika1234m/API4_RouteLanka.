const env = (k: string, fallback?: string): string => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`Missing environment variable ${k}`);
  return v;
};

export const config = {
  port: Number(env("PORT", "4000")),
  databaseUrl: env("DATABASE_URL", "postgres://routelanka:routelanka@localhost:5433/routelanka"),
  rabbitUrl: env("RABBITMQ_URL", "amqp://routelanka:routelanka@localhost:5672/"),
  /** Signs session cookies. Set a long random value in production. */
  sessionSecret: env("SESSION_SECRET", "dev-only-secret-change-me-in-production-please"),
  /** Shared secret the SMS gateway puts on inbound messages. */
  smsGatewayToken: env("SMS_GATEWAY_TOKEN", "dev-sms-token"),
  cookieSecure: env("COOKIE_SECURE", "false") === "true",
  instanceId: env("HOSTNAME", `api-${process.pid}`),
};
