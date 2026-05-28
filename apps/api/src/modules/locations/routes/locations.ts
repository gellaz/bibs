import { Elysia, t } from "elysia";
import { PaginationQuery } from "@/lib/pagination";
import { ok, okPage } from "@/lib/responses";
import {
	CountrySchema,
	MunicipalityCompactSchema,
	MunicipalitySchema,
	okPageRes,
	okRes,
	ProvinceSchema,
	RegionSchema,
	withErrors,
} from "@/lib/schemas";
import {
	listAllMunicipalities,
	listCountries,
	listMunicipalities,
	listProvinces,
	listRegions,
} from "../services/locations";

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
			set.headers["cache-control"] =
				"public, max-age=86400, stale-while-revalidate=604800";
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
	);
