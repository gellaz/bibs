import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "@/db";
import { doc } from "@/http/openapi";
import { publicRoute } from "@/http/routes";
import { json } from "@/http/send";
import { checkBucket } from "@/lib/s3";

export const healthRoutes = new Hono()
	.get(
		"/health",
		doc({
			detail: {
				summary: "Liveness check",
				description:
					"Verifica che il processo sia attivo. Sempre 200 se il server risponde. Usato come liveness probe (Docker, K8s).",
				tags: ["System"],
			},
		}),
		publicRoute,
		(c) => json(c, { status: "ok" }, 200),
	)
	.get(
		"/ready",
		doc({
			detail: {
				summary: "Readiness check",
				description:
					"Verifica la connettività a database e storage S3. Restituisce 503 se uno dei servizi non è raggiungibile. Usato come readiness probe (Docker, K8s).",
				tags: ["System"],
			},
		}),
		publicRoute,
		async (c) => {
			const checks = await Promise.allSettled([
				db.execute(sql`SELECT 1`).then(() => true),
				checkBucket(),
			]);

			const [dbCheck, s3Check] = checks.map((r) =>
				r.status === "fulfilled" ? r.value : false,
			);

			const healthy = dbCheck && s3Check;
			return json(
				c,
				{
					status: healthy ? "ok" : "unhealthy",
					services: {
						database: dbCheck ? "ok" : "unreachable",
						s3: s3Check ? "ok" : "unreachable",
					},
				},
				healthy ? 200 : 503,
			);
		},
	);
