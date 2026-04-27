import { Elysia, t } from "elysia";
import { ok } from "@/lib/responses";
import { okRes, withErrors } from "@/lib/schemas";
import { countConfigurations } from "../services/configurations";

export const configurationsRoutes = new Elysia().get(
	"/configurations/counts",
	async () => {
		const data = await countConfigurations();
		return ok(data);
	},
	{
		response: withErrors({
			200: okRes(
				t.Object({
					productCategories: t.Number({
						description: "Numero totale di sotto-categorie prodotto",
					}),
					productMacroCategories: t.Number({
						description: "Numero totale di macro categorie prodotto",
					}),
					storeCategories: t.Number({
						description: "Numero totale di categorie negozio",
					}),
				}),
			),
		}),
		detail: {
			summary: "Contatori configurazioni",
			description:
				"Restituisce il numero totale di macro categorie prodotto, sotto-categorie prodotto e categorie negozio.",
			tags: ["Admin"],
		},
	},
);
