import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schemas";

const pool = new Pool({
	connectionString: env.DATABASE_URL,
	max: Number.parseInt(env.DATABASE_POOL_MAX, 10),
	idleTimeoutMillis: Number.parseInt(env.DATABASE_IDLE_TIMEOUT_MS, 10),
	connectionTimeoutMillis: Number.parseInt(
		env.DATABASE_CONNECTION_TIMEOUT_MS,
		10,
	),
});

export const db = drizzle(pool, { schema });
