import { Elysia, t } from "elysia";
import { PaginationQuery } from "@/lib/pagination";
import { ok, okPage } from "@/lib/responses";
import {
	MunicipalitySchema,
	okPageRes,
	okRes,
	ProvinceSchema,
	RegionSchema,
	withErrors,
} from "@/lib/schemas";
import {
	listMunicipalities,
	listProvinces,
	listRegions,
} from "../services/locations";

export const locationsRoutes = new Elysia()
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
	);
