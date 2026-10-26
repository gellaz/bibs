import { Hono } from "hono";
import { OPENAPI_PAGE } from "@/http/openapi-page";
import { json } from "@/http/send";
import { OpenAPI } from "@/infra/auth";

const info = {
	title: "bibs API",
	description: "API per il marketplace di commercio locale bibs",
	version: "1.0.0",
};

const tags = [
	{ name: "Auth", description: "Autenticazione e sessione utente" },
	{ name: "Registration", description: "Registrazione clienti e venditori" },
	{
		name: "Product Categories",
		description: "Categorie prodotto (lettura pubblica)",
	},
	{
		name: "Store Categories",
		description: "Categorie negozio (lettura pubblica)",
	},
	{ name: "Admin", description: "Gestione categorie e verifica venditori" },
	{ name: "Admin - Billing", description: "Billing aggregato lato admin" },
	{
		name: "Seller - Billing",
		description: "Billing, abbonamenti e Customer Portal",
	},
	{ name: "Seller - Stores", description: "Gestione negozi del venditore" },
	{ name: "Seller - Products", description: "Gestione prodotti e catalogo" },
	{
		name: "Seller - Product Images",
		description: "Upload e gestione immagini prodotto",
	},
	{
		name: "Seller - Stock",
		description: "Assegnazione prodotti ai negozi e gestione stock",
	},
	{ name: "Seller - Orders", description: "Gestione ordini lato venditore" },
	{ name: "Seller - Dashboard", description: "Riepilogo della home venditore" },
	{
		name: "Seller - Employees",
		description: "Gestione dipendenti del venditore",
	},
	{
		name: "Seller - Profile",
		description: "Profilo venditore e gestione partita IVA",
	},
	{ name: "Customer - Search", description: "Ricerca prodotti (pubblica)" },
	{
		name: "Customer - Addresses",
		description: "Gestione indirizzi di spedizione",
	},
	{ name: "Customer - Points", description: "Programma fedeltà e punti" },
	{ name: "Customer - Orders", description: "Ordini del cliente" },
	{ name: "Locations", description: "Regioni, province e comuni italiani" },
	{ name: "Me", description: "Profilo dell'utente corrente" },
	{ name: "System", description: "Health check e stato del servizio" },
];

/**
 * Il documento OpenAPI 3.1.2: i path delle route Hono (`honoPaths`, D11) più
 * quelli e i componenti di better-auth, con le stesse chiavi di prima.
 */
async function document(paths: Record<string, unknown>) {
	return {
		info,
		tags,
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
		paths: { ...(await OpenAPI.getPaths()), ...paths },
		openapi: "3.1.2",
	};
}

/** GET /openapi (pagina Scalar) e GET /openapi/json; fuori dal documento. */
export function openapiRoutes(paths: Record<string, unknown>) {
	let spec: ReturnType<typeof document> | undefined;
	return new Hono()
		.get("/openapi", (c) =>
			c.body(OPENAPI_PAGE, 200, { "content-type": "text/html; charset=utf8" }),
		)
		.get("/openapi/json", async (c) => {
			// Una sola costruzione; un fallimento non resta in cache.
			spec ??= document(paths).catch((error) => {
				spec = undefined;
				throw error;
			});
			return json(c, await spec, 200);
		});
}
