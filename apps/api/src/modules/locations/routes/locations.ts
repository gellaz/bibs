import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "@/http/auth";
import { doc } from "@/http/openapi";
import { publicRoute } from "@/http/routes";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { ok, okPage } from "@/lib/responses";
import {
	CountrySchema,
	GeocodeSuggestionSchema,
	MunicipalityCompactSchema,
	MunicipalitySchema,
	ProvinceSchema,
	RegionSchema,
} from "@/lib/schemas/entities";
import {
	GeocodeQuery,
	MunicipalitiesQuery,
	ProvincesQuery,
} from "@/lib/schemas/locations";
import {
	okPageRes,
	okRes,
	ServiceUnavailableError,
	TooManyRequestsError,
	withErrors,
} from "@/lib/schemas/responses";
import { rateLimit } from "@/plugins/rate-limit";
import { geocodeAddress } from "../services/geocode";
import {
	listAllMunicipalities,
	listCountries,
	listMunicipalities,
	listProvinces,
	listRegions,
} from "../services/locations";

const MINUTE = 60_000;

export const CountriesResponse = okRes(z.array(CountrySchema));
export const RegionsResponse = okRes(z.array(RegionSchema));
export const ProvincesResponse = okRes(z.array(ProvinceSchema));
export const MunicipalitiesResponse = okPageRes(MunicipalitySchema);
export const MunicipalitiesAllResponse = okRes(
	z.array(MunicipalityCompactSchema),
);
export const GeocodeResponse = okRes(z.array(GeocodeSuggestionSchema));

// Route relative: il modulo è montato su /locations (`src/app.ts`). Tutte
// pubbliche tranne /geocode (login, poi rate limit).
export const locationsRoutes = new Hono()
	.get(
		"/countries",
		doc({
			response: withErrors({ 200: CountriesResponse }),
			detail: {
				summary: "Lista paesi",
				description:
					"Restituisce la lista completa dei paesi (ISO 3166-1 alpha-2) con nome in italiano.",
				tags: ["Locations"],
			},
		}),
		publicRoute,
		(c) => send(c, CountriesResponse, ok([...listCountries()])),
	)
	.get(
		"/regions",
		doc({
			response: withErrors({ 200: RegionsResponse }),
			detail: {
				summary: "Lista regioni",
				description: "Restituisce la lista di tutte le regioni italiane.",
				tags: ["Locations"],
			},
		}),
		publicRoute,
		async (c) => send(c, RegionsResponse, ok(await listRegions())),
	)
	.get(
		"/provinces",
		doc({
			response: withErrors({ 200: ProvincesResponse }),
			detail: {
				summary: "Lista province",
				description:
					"Restituisce la lista delle province, con filtro opzionale per regione.",
				tags: ["Locations"],
			},
		}),
		v("query", ProvincesQuery),
		publicRoute,
		async (c) =>
			send(c, ProvincesResponse, ok(await listProvinces(c.req.valid("query")))),
	)
	.get(
		"/municipalities",
		doc({
			response: withErrors({ 200: MunicipalitiesResponse }),
			detail: {
				summary: "Lista comuni",
				description:
					"Restituisce la lista paginata dei comuni, con filtro opzionale per provincia.",
				tags: ["Locations"],
			},
		}),
		v("query", MunicipalitiesQuery),
		publicRoute,
		async (c) => {
			const result = await listMunicipalities(c.req.valid("query"));
			return send(
				c,
				MunicipalitiesResponse,
				okPage(result.data, result.pagination),
			);
		},
	)
	.get(
		"/municipalities/all",
		doc({
			response: withErrors({ 200: MunicipalitiesAllResponse }),
			detail: {
				summary: "Lista completa comuni (formato compatto)",
				description:
					"Restituisce l'elenco di TUTTI i comuni italiani con sigla provincia, in formato compatto e ordinati per nome. Endpoint pensato per precaricamento client-side; risposta cacheable 24h.",
				tags: ["Locations"],
			},
		}),
		publicRoute,
		async (c) => {
			const data = await listAllMunicipalities();
			// In production: aggressive cache (lista immutabile). In dev: no cache
			// così un db:reset rigenera correttamente gli UUID lato client senza
			// rischiare FK violations da cache HTTP stale.
			c.header(
				"cache-control",
				env.NODE_ENV === "production"
					? "public, max-age=86400, stale-while-revalidate=604800"
					: "no-store",
			);
			return send(c, MunicipalitiesAllResponse, ok(data));
		},
	)
	.get(
		"/geocode",
		doc({
			response: withErrors({
				200: GeocodeResponse,
				429: TooManyRequestsError,
				503: ServiceUnavailableError,
			}),
			detail: {
				summary: "Geocoding indirizzo",
				description:
					"Trasforma un testo digitato in suggerimenti di indirizzo con coordinate e comune già risolto sui comuni italiani. Con `lat`/`lng` i risultati vicini vengono primi; se il testo nomina un comune, i risultati di quel comune hanno la precedenza. Richiede autenticazione.",
				tags: ["Locations"],
				security: [{ bearerAuth: [] }],
			},
		}),
		v("query", GeocodeQuery),
		requireAuth,
		rateLimit({
			name: "geocode",
			limits: [{ by: "ip", window: MINUTE, max: 30 }],
		}),
		async (c) => {
			const query = c.req.valid("query");
			const data = await geocodeAddress(query);
			logger.info(
				{
					userId: c.var.user.id,
					queryLength: query.q.length,
					hasBias: query.lat !== undefined && query.lng !== undefined,
					resultCount: data.length,
					action: "address_geocode",
				},
				"Geocoding indirizzo eseguito",
			);
			return send(c, GeocodeResponse, ok(data));
		},
	);
