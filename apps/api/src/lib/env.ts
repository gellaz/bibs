import { Type as t } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const EnvSchema = t.Object({
	DATABASE_URL: t.String(),
	BETTER_AUTH_SECRET: t.String(),
	BETTER_AUTH_URL: t.String(),
	S3_ENDPOINT: t.String(),
	S3_ACCESS_KEY: t.String(),
	S3_SECRET_KEY: t.String(),
	S3_BUCKET: t.String(),
	PORT: t.Optional(t.String()),
	SEED_DB: t.Optional(t.String()),
	ALLOWED_ORIGINS: t.Optional(t.String()),
	NODE_ENV: t.Optional(t.String()),
	RESEND_API_KEY: t.Optional(t.String()),
	EMAIL_FROM: t.Optional(t.String()),
	CUSTOMER_APP_URL: t.Optional(t.String()),
	SELLER_APP_URL: t.Optional(t.String()),
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
	BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
	BETTER_AUTH_URL: process.env.BETTER_AUTH_URL!,
	S3_ENDPOINT: process.env.S3_ENDPOINT!,
	S3_ACCESS_KEY: process.env.S3_ACCESS_KEY!,
	S3_SECRET_KEY: process.env.S3_SECRET_KEY!,
	S3_BUCKET: process.env.S3_BUCKET!,
	PORT: process.env.PORT ?? "3000",
	SEED_DB: process.env.SEED_DB ?? "false",
	ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
	NODE_ENV: process.env.NODE_ENV ?? "development",
	RESEND_API_KEY: process.env.RESEND_API_KEY,
	EMAIL_FROM: process.env.EMAIL_FROM,
	CUSTOMER_APP_URL: process.env.CUSTOMER_APP_URL ?? "http://localhost:3001",
	SELLER_APP_URL: process.env.SELLER_APP_URL ?? "http://localhost:3002",
} as const;
