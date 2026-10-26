import { z } from "zod";

const EnvSchema = z.object({
	DATABASE_URL: z.string(),
	DATABASE_POOL_MAX: z.string().optional(),
	DATABASE_IDLE_TIMEOUT_MS: z.string().optional(),
	DATABASE_CONNECTION_TIMEOUT_MS: z.string().optional(),
	BETTER_AUTH_SECRET: z.string(),
	BETTER_AUTH_URL: z.string(),
	S3_ENDPOINT: z.string(),
	S3_ACCESS_KEY: z.string(),
	S3_SECRET_KEY: z.string(),
	S3_BUCKET: z.string(),
	PORT: z.string().optional(),
	ALLOWED_ORIGINS: z.string().optional(),
	NODE_ENV: z.string().optional(),
	TRUST_PROXY: z.string().optional(),
	RESEND_API_KEY: z.string().optional(),
	EMAIL_FROM: z.string().optional(),
	SUPPORT_EMAIL: z.string().optional(),
	MAILPIT_URL: z.string().optional(),
	CUSTOMER_APP_URL: z.string().optional(),
	SELLER_APP_URL: z.string().optional(),
	ADMIN_APP_URL: z.string().optional(),
	STRIPE_SECRET_KEY: z.string(),
	STRIPE_WEBHOOK_SECRET: z.string().optional(),
	STRIPE_CONNECT_WEBHOOK_SECRET: z.string().optional(),
	STRIPE_THIN_WEBHOOK_SECRET: z.string().optional(),
	STRIPE_DEV_PRICE_ID: z.string().optional(),
	GEOCODING_PROVIDER: z.string().optional(),
	PHOTON_URL: z.string().optional(),
	GEOCODING_USER_AGENT: z.string().optional(),
});

const checked = EnvSchema.safeParse(process.env);
if (!checked.success) {
	const missing = checked.error.issues.map((e) => e.path.join(".")).join(", ");
	console.error(`❌ Missing or invalid env vars: ${missing}`);
	process.exit(1);
}

/** Validated environment variables — import this instead of using process.env directly. */
export const env = {
	DATABASE_URL: process.env.DATABASE_URL!,
	DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX ?? "20",
	DATABASE_IDLE_TIMEOUT_MS: process.env.DATABASE_IDLE_TIMEOUT_MS ?? "30000",
	DATABASE_CONNECTION_TIMEOUT_MS:
		process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? "5000",
	BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
	BETTER_AUTH_URL: process.env.BETTER_AUTH_URL!,
	S3_ENDPOINT: process.env.S3_ENDPOINT!,
	S3_ACCESS_KEY: process.env.S3_ACCESS_KEY!,
	S3_SECRET_KEY: process.env.S3_SECRET_KEY!,
	S3_BUCKET: process.env.S3_BUCKET!,
	PORT: process.env.PORT ?? "3000",
	ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
	NODE_ENV: process.env.NODE_ENV ?? "development",
	// Only trust client-supplied X-Forwarded-For when behind a known reverse proxy.
	TRUST_PROXY: process.env.TRUST_PROXY ?? "false",
	RESEND_API_KEY: process.env.RESEND_API_KEY,
	EMAIL_FROM: process.env.EMAIL_FROM,
	// Indirizzo che i venditori vedono per contattare il supporto (email e app).
	SUPPORT_EMAIL: process.env.SUPPORT_EMAIL ?? "supporto@bibs.it",
	MAILPIT_URL: process.env.MAILPIT_URL,
	CUSTOMER_APP_URL: process.env.CUSTOMER_APP_URL ?? "http://localhost:3001",
	SELLER_APP_URL: process.env.SELLER_APP_URL ?? "http://localhost:3002",
	ADMIN_APP_URL: process.env.ADMIN_APP_URL ?? "http://localhost:3003",
	STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY!,
	STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
	STRIPE_CONNECT_WEBHOOK_SECRET: process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
	STRIPE_THIN_WEBHOOK_SECRET: process.env.STRIPE_THIN_WEBHOOK_SECRET,
	STRIPE_DEV_PRICE_ID: process.env.STRIPE_DEV_PRICE_ID,
	GEOCODING_PROVIDER: process.env.GEOCODING_PROVIDER ?? "photon",
	PHOTON_URL: process.env.PHOTON_URL ?? "https://photon.komoot.io/api",
	// Photon chiede di identificarsi: un contatto reale evita di finire bloccati.
	GEOCODING_USER_AGENT:
		process.env.GEOCODING_USER_AGENT ?? "bibs/1.0 (+https://bibs.it)",
} as const;
