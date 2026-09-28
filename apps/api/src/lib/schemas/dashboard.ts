import { t } from "elysia";

const Count = (description: string) => t.Integer({ minimum: 0, description });

export const SellerDashboardSchema = t.Object({
	stats: t.Object({
		ordersToday: Count(
			"Ordini creati oggi (giorno di calendario Europe/Rome), esclusi quelli in attesa di pagamento, annullati o scaduti",
		),
		revenueToday: t.String({
			description:
				"Somma lorda (IVA inclusa) degli stessi ordini, in formato decimale (es. '42.50')",
		}),
		activeProducts: Count("Prodotti attivi presenti nel negozio"),
		activePromotions: Count(
			"Promozioni del venditore in corso adesso (attive, iniziate e non ancora finite)",
		),
	}),
	actions: t.Object({
		ordersToPrepare: t.Object({
			count: Count("Ordini confermati da preparare"),
			oldestCreatedAt: t.Nullable(
				t.Date({
					description: "Creazione dell'ordine da preparare più vecchio",
				}),
			),
		}),
		outOfStock: t.Object({
			count: Count("Prodotti attivi del negozio con stock a zero"),
			sampleNames: t.Array(t.String(), {
				maxItems: 2,
				description:
					"Fino a due nomi di prodotti esauriti, in ordine alfabetico",
			}),
		}),
		lowStock: t.Object({
			count: Count(
				"Prodotti attivi del negozio con stock sopra zero ma sotto la soglia",
			),
			threshold: Count("Soglia di scorta bassa del negozio"),
		}),
		expiringPromotions: t.Object({
			count: Count("Promozioni in corso che finiscono entro 3 giorni"),
			first: t.Nullable(
				t.Object({
					name: t.String({ description: "Titolo della promozione" }),
					endsAt: t.Date({ description: "Fine della promozione" }),
				}),
				{ description: "La promozione che finisce per prima" },
			),
		}),
	}),
});
