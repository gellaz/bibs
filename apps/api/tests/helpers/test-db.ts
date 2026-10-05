import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
	GenericContainer,
	getContainerRuntimeClient,
	ImageName,
	type StartedTestContainer,
	Wait,
} from "testcontainers";
import * as schema from "@/db/schemas";

export type DrizzleTestDb = ReturnType<typeof drizzle<typeof schema>>;

const API_DIR = path.resolve(import.meta.dir, "../../");
const MIGRATIONS_DIR = path.resolve(API_DIR, "src/db/migrations");
const TEST_IMAGE = "bibs-postgis-test:latest";

let container: StartedTestContainer | null = null;
let pool: Pool | null = null;
let _testDb: DrizzleTestDb | null = null;

/**
 * Returns the active test DB instance.
 * Used as a getter in mock.module("@/db") factories so the correct instance
 * is returned each time `db` is accessed inside service functions.
 */
export function getTestDb(): DrizzleTestDb {
	if (!_testDb)
		throw new Error(
			"Test DB not initialized. Call setupTestContainer() first.",
		);
	return _testDb;
}

/**
 * Starts a PostGIS container from the prebuilt test image,
 * applies the Drizzle migrations, and returns a connected Drizzle instance.
 *
 * Call this in beforeAll() with a generous timeout.
 */
export async function setupTestContainer(): Promise<DrizzleTestDb> {
	// The image is built once per run by `bun run test:image` (chained into
	// `test:integration`), never here. Building it in every test file meant
	// 4 concurrent BuildKit builds of the same tag under `--parallel=4`, and
	// one now and then hung forever on "load remote build context" — the
	// build has no timeout, so the file failed on its 120s beforeAll.
	const client = await getContainerRuntimeClient();
	if (!(await client.image.exists(ImageName.fromString(TEST_IMAGE)))) {
		throw new Error(
			`Test image "${TEST_IMAGE}" not found: run \`bun run test:image\` in apps/api first.`,
		);
	}

	const start = () =>
		new GenericContainer(TEST_IMAGE)
			.withEnvironment({
				POSTGRES_DB: "bibs_test",
				POSTGRES_USER: "test",
				POSTGRES_PASSWORD: "test",
			})
			.withExposedPorts(5432)
			.withWaitStrategy(
				Wait.forLogMessage("database system is ready to accept connections", 2),
			)
			.start();
	// testcontainers gives Docker a hardcoded 10s to publish the mapped port;
	// with several containers starting at once Docker Desktop occasionally
	// misses it. Retry once on that error only — Ryuk reaps the leftover.
	try {
		container = await start();
	} catch (err) {
		if (!(err instanceof Error && err.message.includes("ports to be bound")))
			throw err;
		container = await start();
	}

	const connectionUri = `postgresql://test:test@${container.getHost()}:${container.getMappedPort(5432)}/bibs_test`;

	pool = new Pool({ connectionString: connectionUri });
	// Without an idle-client 'error' handler, a connection dropped during
	// teardown (container.stop) surfaces as an unhandled error and fails the
	// whole bun run despite 0 test failures. Swallow idle-client errors.
	pool.on("error", () => {});
	_testDb = drizzle(pool, { schema });
	// Apply the real migration files (the same path as prod `bun run db:migrate`)
	// so the suite exercises the actual DDL — including CHECK constraints, which
	// `drizzle-kit push` silently skips.
	await migrate(_testDb, { migrationsFolder: MIGRATIONS_DIR });
	return _testDb;
}

/**
 * Stops the container and clears the DB instance.
 * Call this in afterAll().
 */
export async function teardownTestContainer(): Promise<void> {
	_testDb = null;
	// End the pool BEFORE stopping the container so connections close
	// gracefully instead of being terminated mid-flight by the dying server.
	if (pool) {
		await pool.end().catch(() => {});
		pool = null;
	}
	if (container) {
		await container.stop();
		container = null;
	}
}
