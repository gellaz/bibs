import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { ok } from "@/lib/responses";
import { okRes, withErrors } from "@/lib/schemas/responses";
import { adminDetail } from "../context";
import { countConfigurations } from "../services/configurations";

const count = (description: string) => z.number().meta({ description });

const ConfigurationCountsResponse = okRes(
	z.object({
		productCategories: count("Numero totale di sotto-categorie prodotto"),
		productMacroCategories: count("Numero totale di macro categorie prodotto"),
		storeCategories: count("Numero totale di categorie negozio"),
		storeMacroCategories: count("Numero totale di macro categorie negozio"),
		productCharacteristics: count(
			"Numero totale di caratteristiche nel dizionario",
		),
	}),
);

export const configurationsRoutes = new Hono().get(
	"/configurations/counts",
	doc({
		response: withErrors({ 200: ConfigurationCountsResponse }),
		detail: adminDetail(
			"Contatori configurazioni",
			"Restituisce il numero totale di macro categorie e categorie, prodotto e negozio, e di caratteristiche prodotto.",
		),
	}),
	requireAdmin,
	async (c) =>
		send(c, ConfigurationCountsResponse, ok(await countConfigurations())),
);
