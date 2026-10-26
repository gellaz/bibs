import { z } from "zod";
import { zDate, zInteger } from "./t";

// Gemello Zod di `lib/schemas/dashboard.ts` (D3 del piano Hono).

const Count = (description: string) => zInteger({ minimum: 0, description });

export const SellerDashboardSchema = z.object({
	stats: z.object({
		ordersToday: Count(
			"Ordini creati oggi (giorno di calendario Europe/Rome), esclusi quelli in attesa di pagamento, annullati o scaduti",
		),
		revenueToday: z.string().meta({
			description:
				"Somma lorda (IVA inclusa) degli stessi ordini, in formato decimale (es. '42.50')",
		}),
		activeProducts: Count("Prodotti attivi presenti nel negozio"),
		activePromotions: Count(
			"Promozioni del venditore in corso adesso (attive, iniziate e non ancora finite)",
		),
	}),
	actions: z.object({
		ordersToPrepare: z.object({
			count: Count("Ordini confermati da preparare"),
			oldestCreatedAt: zDate({
				description: "Creazione dell'ordine da preparare più vecchio",
			}).nullable(),
		}),
		outOfStock: z.object({
			count: Count("Prodotti attivi del negozio con stock a zero"),
			sampleNames: z.array(z.string()).max(2).meta({
				description:
					"Fino a due nomi di prodotti esauriti, in ordine alfabetico",
			}),
		}),
		lowStock: z.object({
			count: Count(
				"Prodotti attivi del negozio con stock sopra zero ma sotto la soglia",
			),
			threshold: Count("Soglia di scorta bassa del negozio"),
		}),
		expiringPromotions: z.object({
			count: Count("Promozioni in corso che finiscono entro 3 giorni"),
			first: z
				.object({
					name: z.string().meta({ description: "Titolo della promozione" }),
					endsAt: zDate({ description: "Fine della promozione" }),
				})
				.nullable()
				.meta({ description: "La promozione che finisce per prima" }),
		}),
	}),
});
