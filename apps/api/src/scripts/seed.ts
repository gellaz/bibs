/**
 * Seed the database with test data.
 *
 * Usage:
 *   bun run db:seed [-- --only=admin|customer|seller]
 */

import { parseSeedArgs } from "@/db/seed/groups";

let only: ReturnType<typeof parseSeedArgs>;
try {
	only = parseSeedArgs(process.argv.slice(2));
} catch (err) {
	console.error((err as Error).message);
	process.exit(1);
}

// Import dinamici: un argomento sbagliato non deve aprire il pool.
const { db } = await import("@/db");
const { seed } = await import("@/db/seed");

await seed(only);
await db.$client.end();
process.exit(0);
