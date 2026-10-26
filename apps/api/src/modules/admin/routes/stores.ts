import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok, okPage } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { AdminStoreListItemSchema } from "@/schemas/composed";
import { StoreListQuery } from "@/schemas/queries";
import { okPageRes, okRes, withErrors } from "@/schemas/responses";
import { zInteger } from "@/schemas/t";
import { adminDetail } from "../context";
import { countStoresByStatus, listStores } from "../services/stores";

const count = (description: string) => zInteger({ minimum: 0, description });

const StoreCountsResponse = okRes(
	z.object({
		all: count("Negozi vivi"),
		active: count("Abbonamento attivo o in cancellazione"),
		past_due: count("Rinnovo fallito"),
		suspended: count("Abbonamento sospeso"),
		none: count("Senza abbonamento o con abbonamento cancellato"),
		deleted: count("Negozi eliminati"),
	}),
);
const StorePageResponse = okPageRes(AdminStoreListItemSchema);

export const storesRoutes = new Hono()
	.get(
		"/stores/counts",
		doc({
			response: withErrors({ 200: StoreCountsResponse }),
			detail: adminDetail(
				"Contatori negozi per tab",
				"Numero di negozi per ogni tab della lista admin, con gli stessi criteri di GET /admin/stores.",
			),
		}),
		requireAdmin,
		async (c) => send(c, StoreCountsResponse, ok(await countStoresByStatus())),
	)
	.get(
		"/stores",
		doc({
			response: withErrors({ 200: StorePageResponse }),
			detail: adminDetail(
				"Lista negozi",
				"Lista paginata di tutti i negozi della piattaforma con venditore, categoria, comune e stato dell'abbonamento. Filtrabile per tab (status), ricerca testuale e ordinamento. Senza status mostra solo i negozi non eliminati.",
			),
		}),
		v("query", StoreListQuery),
		requireAdmin,
		async (c) => {
			const result = await listStores(c.req.valid("query"));
			return send(c, StorePageResponse, okPage(result.data, result.pagination));
		},
	);
