import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import logixlysia from "logixlysia";
import { db } from "@/db";
import { OpenAPI } from "@/lib/auth";
import { env } from "@/lib/env";
import { clearAllTimers, restoreTimers } from "@/lib/jobs/reservation-timer";
import { pinoOptions } from "@/lib/logger";
import { ensureBucket } from "@/lib/s3";
import { adminModule } from "@/modules/admin";
import { categoriesModule } from "@/modules/categories";
import { customerModule } from "@/modules/customer";
import { locationsModule } from "@/modules/locations";
import { registration } from "@/modules/registration";
import { sellerModule } from "@/modules/seller";
import { betterAuth } from "@/plugins/better-auth";
import { cronJobs } from "@/plugins/cron";
import { errorHandler } from "@/plugins/error-handler";
import { health } from "@/plugins/health";
import { requestId } from "@/plugins/request-id";

const app = new Elysia()
	.use(
		logixlysia({
			config: {
				showStartupMessage: true,
				startupMessageFormat: "banner",
				customLogFormat:
					"{now} {level} {duration}ms {method} {pathname} {status} {ip}",
				logFilePath: "./logs/app.log",
				logRotation: {
					maxSize: "100m",
					interval: "1d",
					maxFiles: "30d",
					compress: true,
				},
				pino: pinoOptions,
			},
		}),
	)
	.use(
		cors({
			origin: (request) => {
				const origin = request.headers.get("origin");
				// In sviluppo, accetta localhost su qualsiasi porta
				if (origin?.match(/^http:\/\/localhost(:\d+)?$/)) {
					return true;
				}
				// In produzione, specifica i domini autorizzati
				const allowedOrigins = env.ALLOWED_ORIGINS?.split(",") || [];
				return allowedOrigins.includes(origin || "");
			},
			methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			credentials: true,
			allowedHeaders: ["Content-Type", "Authorization"],
			exposeHeaders: ["Content-Length", "X-Request-Id"],
			maxAge: 86400, // 24 ore
		}),
	)
	.use(errorHandler)
	.use(requestId)
	.use(
		openapi({
			documentation: {
				info: {
					title: "Bibs API",
					description: "API per il marketplace di commercio locale Bibs",
					version: "1.0.0",
				},
				tags: [
					{ name: "Auth", description: "Autenticazione e sessione utente" },
					{
						name: "Registration",
						description: "Registrazione clienti e venditori",
					},
					{
						name: "Categories",
						description: "Categorie prodotto (lettura pubblica)",
					},
					{
						name: "Admin",
						description: "Gestione categorie e verifica venditori",
					},
					{
						name: "Seller - Stores",
						description: "Gestione negozi del venditore",
					},
					{
						name: "Seller - Products",
						description: "Gestione prodotti e catalogo",
					},
					{
						name: "Seller - Product Images",
						description: "Upload e gestione immagini prodotto",
					},
					{
						name: "Seller - Stock",
						description: "Assegnazione prodotti ai negozi e gestione stock",
					},
					{
						name: "Seller - Orders",
						description: "Gestione ordini lato venditore",
					},
					{
						name: "Seller - Employees",
						description: "Gestione dipendenti del venditore",
					},
					{
						name: "Seller - Profile",
						description: "Profilo venditore e gestione partita IVA",
					},
					{
						name: "Customer - Search",
						description: "Ricerca prodotti (pubblica)",
					},
					{
						name: "Customer - Addresses",
						description: "Gestione indirizzi di spedizione",
					},
					{
						name: "Customer - Points",
						description: "Programma fedeltà e punti",
					},
					{ name: "Customer - Orders", description: "Ordini del cliente" },
					{
						name: "Locations",
						description: "Regioni, province e comuni italiani",
					},
					{ name: "System", description: "Health check e stato del servizio" },
				],
				components: {
					...(await OpenAPI.components),
					securitySchemes: {
						bearerAuth: {
							type: "http",
							scheme: "bearer",
							description: "Token di sessione better-auth",
						},
					},
				},
				paths: await OpenAPI.getPaths(),
			},
		}),
	)
	.use(betterAuth)
	.use(registration)
	.use(adminModule)
	.use(categoriesModule)
	.use(locationsModule)
	.use(sellerModule)
	.use(customerModule)
	.use(cronJobs)
	.use(health);

// ── Startup sequence ────────────────────────────────
await ensureBucket();
await restoreTimers();

if (env.SEED_DB === "true") {
	const { seed } = await import("@/db/seed");
	await seed();
}

const port = parseInt(env.PORT, 10);
app.listen(port);

// ── Graceful shutdown ───────────────────────────────
const shutdown = async () => {
	console.log("\n🛑 Shutting down...");
	app.stop();
	clearAllTimers();
	await db.$client.end();
	process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Export type for Eden Treaty (frontend type-safety)
export type App = typeof app;
