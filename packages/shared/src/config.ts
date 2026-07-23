import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  WEBHOOK_SECRET: z.string().default("dev-secret"),
  DASHBOARD_API_KEY: z.string().default("dev-dashboard-key"),

  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL_DEFAULT: z.string().default("claude-opus-4-8"),
  AI_MODEL_CONVERSATION: z.string().optional(),
  AI_MODEL_EXTRACTION: z.string().optional(),
  AI_MODEL_SCORING: z.string().optional(),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  SENDGRID_API_KEY: z.string().optional(),
  SENDGRID_FROM_EMAIL: z.string().optional(),
  SENDGRID_FROM_NAME: z.string().optional(),

  RETELL_API_KEY: z.string().optional(),
  RETELL_AGENT_ID: z.string().optional(),
  RETELL_FROM_NUMBER: z.string().optional(),

  DROPCOWBOY_TEAM_ID: z.string().optional(),
  DROPCOWBOY_SECRET: z.string().optional(),
  DROPCOWBOY_BRAND_ID: z.string().optional(),

  LOB_API_KEY: z.string().optional(),
  HANDWRYTTEN_API_KEY: z.string().optional(),

  BATCHDATA_API_KEY: z.string().optional(),
  ATTOM_API_KEY: z.string().optional(),
  PROPERTYRADAR_API_KEY: z.string().optional(),

  SKIPTRACE_PRIMARY: z.string().default("batchdata"),
  SKIPTRACE_PREMIUM: z.string().optional(),
  IDI_CLIENT_ID: z.string().optional(),
  IDI_CLIENT_SECRET: z.string().optional(),

  GHL_API_KEY: z.string().optional(),
  GHL_LOCATION_ID: z.string().optional(),

  OWNER_NAME: z.string().default("David"),
  OWNER_PHONE: z.string().optional(),
  OWNER_EMAIL: z.string().optional(),
  SLACK_WEBHOOK_URL: z.string().optional(),

  OUTBOUND_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase() === "true"),
  SMS_WEEKLY_CAP: z.coerce.number().default(3),
  DNC_SCRUB_API_KEY: z.string().optional(),

  LOG_LEVEL: z.string().default("info"),
  SENTRY_DSN: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | null = null;

/** Parse and cache environment configuration. Throws on invalid config. */
export function getConfig(): AppConfig {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new Error(`Invalid environment configuration: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Model to use for a given agent role, falling back to the default. */
export function modelFor(role: "conversation" | "extraction" | "scoring" | "default"): string {
  const cfg = getConfig();
  switch (role) {
    case "conversation":
      return cfg.AI_MODEL_CONVERSATION ?? cfg.AI_MODEL_DEFAULT;
    case "extraction":
      return cfg.AI_MODEL_EXTRACTION ?? cfg.AI_MODEL_DEFAULT;
    case "scoring":
      return cfg.AI_MODEL_SCORING ?? cfg.AI_MODEL_DEFAULT;
    default:
      return cfg.AI_MODEL_DEFAULT;
  }
}
