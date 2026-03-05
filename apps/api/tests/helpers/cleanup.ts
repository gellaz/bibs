import { sql } from "drizzle-orm";
import type { DrizzleTestDb } from "./test-db";

/**
 * Truncates all user tables in the public schema with CASCADE.
 * Dynamically queries pg_tables so no hardcoded list is needed.
 * Call this in beforeEach() to isolate tests from each other.
 */
export async function truncateAll(db: DrizzleTestDb): Promise<void> {
	await db.execute(
		sql.raw(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
      )
      LOOP
        EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', r.tablename);
      END LOOP;
    END $$;
  `),
	);
}
