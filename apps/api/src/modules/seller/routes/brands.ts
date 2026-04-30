import { Elysia, t } from "elysia";
import { ok, okPage } from "@/lib/responses";
import { BrandSchema, okPageRes, okRes, withErrors } from "@/lib/schemas";
import { withSeller } from "../context";
import { findOrCreateBrandByName, listBrands } from "../services/brands";

const ListBrandsQuery = t.Object({
	page: t.Optional(
		t.Number({ minimum: 1, default: 1, description: "Numero di pagina" }),
	),
	limit: t.Optional(
		t.Number({
			minimum: 1,
			maximum: 100,
			default: 20,
			description: "Elementi per pagina",
		}),
	),
	q: t.Optional(
		t.String({
			maxLength: 120,
			description: "Filtro testuale (case-insensitive)",
		}),
	),
});

export const brandsRoutes = new Elysia()
	.get(
		"/brands",
		async (ctx) => {
			const { sellerProfile: sp, query } = withSeller(ctx);
			const result = await listBrands({ sellerProfileId: sp.id, ...query });
			return okPage(result.data, result.pagination);
		},
		{
			query: ListBrandsQuery,
			response: withErrors({ 200: okPageRes(BrandSchema) }),
			detail: {
				summary: "Lista brand del venditore",
				description:
					"Restituisce la lista paginata dei brand del venditore corrente, con filtro opzionale per nome (case-insensitive).",
				tags: ["Seller - Brands"],
			},
		},
	)
	.post(
		"/brands",
		async (ctx) => {
			const { sellerProfile: sp, body } = withSeller(ctx);
			const data = await findOrCreateBrandByName({
				sellerProfileId: sp.id,
				name: body.name,
			});
			return ok(data);
		},
		{
			body: t.Object({
				name: t.String({
					minLength: 1,
					maxLength: 120,
					description: "Nome del brand",
				}),
			}),
			response: withErrors({ 200: okRes(BrandSchema) }),
			detail: {
				summary: "Crea o restituisce un brand esistente",
				description:
					"Match-or-create: se esiste già un brand con lo stesso nome (case-insensitive) per il venditore, lo restituisce invece di crearne uno nuovo.",
				tags: ["Seller - Brands"],
			},
		},
	);
