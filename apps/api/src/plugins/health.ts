import { sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { db } from "@/db";
import { checkBucket } from "@/lib/s3";

export const health = new Elysia({ name: "health" })
	.get("/health", () => ({ status: "ok" }), {
		detail: {
			summary: "Liveness check",
			description:
				"Verifica che il processo sia attivo. Sempre 200 se il server risponde. Usato come liveness probe (Docker, K8s).",
			tags: ["System"],
		},
	})
	.get(
		"/ready",
		async ({ set }) => {
			const checks = await Promise.allSettled([
				db.execute(sql`SELECT 1`).then(() => true),
				checkBucket(),
			]);

			const [dbCheck, s3Check] = checks.map((r) =>
				r.status === "fulfilled" ? r.value : false,
			);

			const healthy = dbCheck && s3Check;
			if (!healthy) set.status = 503;

			return {
				status: healthy ? "ok" : "unhealthy",
				services: {
					database: dbCheck ? "ok" : "unreachable",
					s3: s3Check ? "ok" : "unreachable",
				},
			};
		},
		{
			detail: {
				summary: "Readiness check",
				description:
					"Verifica la connettività a database e S3/MinIO. Restituisce 503 se uno dei servizi non è raggiungibile. Usato come readiness probe (Docker, K8s).",
				tags: ["System"],
			},
		},
	);
