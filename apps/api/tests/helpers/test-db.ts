import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import {
	GenericContainerBuilder,
	type StartedTestContainer,
	Wait,
} from "testcontainers";
import * as schema from "@/db/schemas";

export type DrizzleTestDb = ReturnType<typeof drizzle<typeof schema>>;

const POSTGIS_DIR = path.resolve(import.meta.dir, "../../../../docker/postgis");
const API_DIR = path.resolve(import.meta.dir, "../../");

let container: StartedTestContainer | null = null;
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
 * Starts a PostGIS container (built from the project Dockerfile),
 * pushes the Drizzle schema, and returns a connected Drizzle instance.
 *
 * Call this in beforeAll() with a generous timeout (~120s on first build).
 */
export async function setupTestContainer(): Promise<DrizzleTestDb> {
	const image = await new GenericContainerBuilder(
		POSTGIS_DIR,
		"Dockerfile",
	).build();

	container = await image
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

	const connectionUri = `postgresql://test:test@${container.getHost()}:${container.getMappedPort(5432)}/bibs_test`;

	await pushSchema(connectionUri);

	_testDb = drizzle(connectionUri, { schema });
	return _testDb;
}

/**
 * Stops the container and clears the DB instance.
 * Call this in afterAll().
 */
export async function teardownTestContainer(): Promise<void> {
	_testDb = null;
	if (container) {
		await container.stop();
		container = null;
	}
}

async function pushSchema(connectionUri: string): Promise<void> {
	const proc = Bun.spawn(["bunx", "drizzle-kit", "push", "--force"], {
		cwd: API_DIR,
		env: { ...process.env, DATABASE_URL: connectionUri },
		stdout: "pipe",
		stderr: "pipe",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`drizzle-kit push failed (exit ${exitCode}):\n${stderr}`);
	}
}
