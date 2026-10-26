import { Hono } from "hono";
import { z } from "zod";
import { requireSeller } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { ok, okPage } from "@/lib/responses";
import { BrandSchema } from "@/lib/schemas/entities";
import { okPageRes, okRes, withErrors } from "@/lib/schemas/responses";
import { zInteger, zString } from "@/lib/schemas/t";
import { findOrCreateBrandByName, listBrands } from "../services/brands";

const ListBrandsQuery = z.object({
	page: zInteger({
		minimum: 1,
		default: 1,
		description: "Numero di pagina",
	}).optional(),
	limit: zInteger({
		minimum: 1,
		maximum: 100,
		default: 20,
		description: "Elementi per pagina",
	}).optional(),
	q: zString({
		maxLength: 120,
		description: "Filtro testuale (case-insensitive)",
	}).optional(),
});

const BrandBody = z.object({
	name: zString({
		minLength: 1,
		maxLength: 120,
		description: "Nome del brand",
	}),
});

const BrandPage = okPageRes(BrandSchema);
const BrandRes = okRes(BrandSchema);

export const brandsRoutes = new Hono()
	.get(
		"/brands",
		doc({
			response: withErrors({ 200: BrandPage }),
			detail: {
				summary: "Lista brand del venditore",
				description:
					"Restituisce la lista paginata dei brand del venditore corrente, con filtro opzionale per nome (case-insensitive).",
				tags: ["Seller - Brands"],
				security: [{ bearerAuth: [] }],
			},
		}),
		v("query", ListBrandsQuery),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp } = c.var.seller;
			const result = await listBrands({
				sellerProfileId: sp.id,
				...c.req.valid("query"),
			});
			return send(c, BrandPage, okPage(result.data, result.pagination));
		},
	)
	.post(
		"/brands",
		doc({
			response: withErrors({ 200: BrandRes }),
			detail: {
				summary: "Crea o restituisce un brand esistente",
				description:
					"Match-or-create: se esiste già un brand con lo stesso nome (case-insensitive) per il venditore, lo restituisce invece di crearne uno nuovo.",
				tags: ["Seller - Brands"],
				security: [{ bearerAuth: [] }],
			},
		}),
		v("json", BrandBody),
		requireSeller,
		async (c) => {
			const { sellerProfile: sp } = c.var.seller;
			const data = await findOrCreateBrandByName({
				sellerProfileId: sp.id,
				name: c.req.valid("json").name,
			});
			return send(c, BrandRes, ok(data));
		},
	);
