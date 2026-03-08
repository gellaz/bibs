/**
 * Seed the database with test data.
 *
 * Usage:
 *   bun run db:seed
 */

import { db } from "@/db";
import { seed } from "@/db/seed";

await seed();
await db.$client.end();
process.exit(0);
