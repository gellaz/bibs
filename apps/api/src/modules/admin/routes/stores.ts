import { Elysia, t } from "elysia";
import { StoreListQuery } from "@/lib/queries";
import { ok, okPage } from "@/lib/responses";
import {
	AdminStoreListItemSchema,
	okPageRes,
	okRes,
	withErrors,
} from "@/lib/schemas";
import { countStoresByStatus, listStores } from "../services/stores";

const count = (description: string) => t.Integer({ minimum: 0, description });

export const storesRoutes = new Elysia()
	.get("/stores/counts", async () => ok(await countStoresByStatus()), {
		response: withErrors({
			200: okRes(
				t.Object({
					all: count("Negozi vivi"),
					active: count("Abbonamento attivo o in cancellazione"),
					past_due: count("Rinnovo fallito"),
					suspended: count("Abbonamento sospeso"),
					none: count("Senza abbonamento o con abbonamento cancellato"),
					deleted: count("Negozi eliminati"),
				}),
			),
		}),
		detail: {
			summary: "Contatori negozi per tab",
			description:
				"Numero di negozi per ogni tab della lista admin, con gli stessi criteri di GET /admin/stores.",
			tags: ["Admin"],
		},
	})
	.get(
		"/stores",
		async ({ query }) => {
			const result = await listStores(query);
			return okPage(result.data, result.pagination);
		},
		{
			query: StoreListQuery,
			response: withErrors({ 200: okPageRes(AdminStoreListItemSchema) }),
			detail: {
				summary: "Lista negozi",
				description:
					"Lista paginata di tutti i negozi della piattaforma con venditore, categoria, comune e stato dell'abbonamento. Filtrabile per tab (status), ricerca testuale e ordinamento. Senza status mostra solo i negozi non eliminati.",
				tags: ["Admin"],
			},
		},
	);
