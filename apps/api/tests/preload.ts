/**
 * Bun test preload — runs before any test file is loaded.
 * Sets the env vars required by @/lib/env so tests don't call process.exit(1).
 * Uses fake but structurally-valid values; no real services are contacted.
 */
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.BETTER_AUTH_SECRET = "test-secret-minimum-32-chars-padding!!";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.S3_ENDPOINT = "http://localhost:9000";
process.env.S3_ACCESS_KEY = "minioadmin";
process.env.S3_SECRET_KEY = "minioadmin";
process.env.S3_BUCKET = "bibs-test";
process.env.NODE_ENV = "test";
process.env.STRIPE_SECRET_KEY = "sk_test_FAKE";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_FAKE";
process.env.STRIPE_DEV_PRICE_ID = "price_FAKE";
