import { Elysia, t } from "elysia";
import { env } from "@/lib/env";
import { getLogger } from "@/lib/logger";
import { PaginationQuery } from "@/lib/pagination";
import { ok, okPage } from "@/lib/responses";
import {
	CountrySchema,
	GeocodeSuggestionSchema,
	MunicipalityCompactSchema,
	MunicipalitySchema,
	okPageRes,
	okRes,
	ProvinceSchema,
	RegionSchema,
	ServiceUnavailableError,
	TooManyRequestsError,
	withErrors,
} from "@/lib/schemas";
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

export const locationsRoutes = new Elysia()
	.get(
		"/countries",
		() => {
			const data = [...listCountries()];
			return ok(data);
		},
		{
			response: withErrors({ 200: okRes(t.Array(CountrySchema)) }),
			detail: {
				summary: "Lista paesi",
				description:
					"Restituisce la lista completa dei paesi (ISO 3166-1 alpha-2) con nome in italiano.",
				tags: ["Locations"],
			},
		},
	)
	.get(
		"/regions",
		async () => {
			const data = await listRegions();
			return ok(data);
		},
		{
			response: withErrors({ 200: okRes(t.Array(RegionSchema)) }),
			detail: {
				summary: "Lista regioni",
				description: "Restituisce la lista di tutte le regioni italiane.",
				tags: ["Locations"],
			},
		},
	)
	.get(
		"/provinces",
		async ({ query }) => {
			const data = await listProvinces(query);
			return ok(data);
		},
		{
			query: t.Object({
				regionId: t.Optional(
					t.String({ description: "Filtra per ID regione" }),
				),
			}),
			response: withErrors({ 200: okRes(t.Array(ProvinceSchema)) }),
			detail: {
				summary: "Lista province",
				description:
					"Restituisce la lista delle province, con filtro opzionale per regione.",
				tags: ["Locations"],
			},
		},
	)
	.get(
		"/municipalities",
		async ({ query }) => {
			const result = await listMunicipalities(query);
			return okPage(result.data, result.pagination);
		},
		{
			query: t.Composite([
				PaginationQuery,
				t.Object({
					provinceId: t.Optional(
						t.String({ description: "Filtra per ID provincia" }),
					),
				}),
			]),
			response: withErrors({ 200: okPageRes(MunicipalitySchema) }),
			detail: {
				summary: "Lista comuni",
				description:
					"Restituisce la lista paginata dei comuni, con filtro opzionale per provincia.",
				tags: ["Locations"],
			},
		},
	)
	.get(
		"/municipalities/all",
		async ({ set }) => {
			const data = await listAllMunicipalities();
			// In production: aggressive cache (lista immutabile). In dev: no cache
			// così un db:reset rigenera correttamente gli UUID lato client senza
			// rischiare FK violations da cache HTTP stale.
			set.headers["cache-control"] =
				env.NODE_ENV === "production"
					? "public, max-age=86400, stale-while-revalidate=604800"
					: "no-store";
			return ok(data);
		},
		{
			response: withErrors({ 200: okRes(t.Array(MunicipalityCompactSchema)) }),
			detail: {
				summary: "Lista completa comuni (formato compatto)",
				description:
					"Restituisce l'elenco di TUTTI i comuni italiani con sigla provincia, in formato compatto e ordinati per nome. Endpoint pensato per precaricamento client-side; risposta cacheable 24h.",
				tags: ["Locations"],
			},
		},
	)
	.get(
		"/geocode",
		async (ctx) => {
			const { user, query, store } = ctx as typeof ctx & {
				user: { id: string };
			};
			const pino = getLogger(store);
			const data = await geocodeAddress(query);
			pino.info(
				{
					userId: user.id,
					queryLength: query.q.length,
					hasBias: query.lat !== undefined && query.lng !== undefined,
					resultCount: data.length,
					action: "address_geocode",
				},
				"Geocoding indirizzo eseguito",
			);
			return ok(data);
		},
		{
			auth: true,
			query: t.Object({
				q: t.String({
					minLength: 3,
					maxLength: 200,
					description: "Testo dell'indirizzo da cercare",
				}),
				limit: t.Optional(
					t.Number({
						minimum: 1,
						maximum: 10,
						default: 5,
						description: "Numero massimo di suggerimenti (default 5)",
					}),
				),
				lat: t.Optional(
					t.Number({
						minimum: -90,
						maximum: 90,
						description:
							"Latitudine da cui cercare: i risultati vicini vengono primi",
					}),
				),
				lng: t.Optional(
					t.Number({
						minimum: -180,
						maximum: 180,
						description: "Longitudine da cui cercare",
					}),
				),
			}),
			beforeHandle: rateLimit({
				name: "geocode",
				limits: [{ by: "ip", window: MINUTE, max: 30 }],
			}),
			response: withErrors({
				200: okRes(t.Array(GeocodeSuggestionSchema)),
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
		},
	);
