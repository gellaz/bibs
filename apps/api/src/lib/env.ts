import { Type as t } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const EnvSchema = t.Object({
	DATABASE_URL: t.String(),
	DATABASE_POOL_MAX: t.Optional(t.String()),
	DATABASE_IDLE_TIMEOUT_MS: t.Optional(t.String()),
	DATABASE_CONNECTION_TIMEOUT_MS: t.Optional(t.String()),
	BETTER_AUTH_SECRET: t.String(),
	BETTER_AUTH_URL: t.String(),
	S3_ENDPOINT: t.String(),
	S3_ACCESS_KEY: t.String(),
	S3_SECRET_KEY: t.String(),
	S3_BUCKET: t.String(),
	PORT: t.Optional(t.String()),
	ALLOWED_ORIGINS: t.Optional(t.String()),
	NODE_ENV: t.Optional(t.String()),
	TRUST_PROXY: t.Optional(t.String()),
	RESEND_API_KEY: t.Optional(t.String()),
	EMAIL_FROM: t.Optional(t.String()),
	CUSTOMER_APP_URL: t.Optional(t.String()),
	SELLER_APP_URL: t.Optional(t.String()),
	STRIPE_SECRET_KEY: t.String(),
	STRIPE_WEBHOOK_SECRET: t.Optional(t.String()),
	STRIPE_DEV_PRICE_ID: t.Optional(t.String()),
});

if (!Value.Check(EnvSchema, process.env)) {
	const errors = [...Value.Errors(EnvSchema, process.env)];
	const missing = errors.map((e) => e.path.replace("/", "")).join(", ");
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
	CUSTOMER_APP_URL: process.env.CUSTOMER_APP_URL ?? "http://localhost:3001",
	SELLER_APP_URL: process.env.SELLER_APP_URL ?? "http://localhost:3002",
	STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY!,
	STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
	STRIPE_DEV_PRICE_ID: process.env.STRIPE_DEV_PRICE_ID,
} as const;
