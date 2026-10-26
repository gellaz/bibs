import { Hono } from "hono";
import { z } from "zod";
import { requireAdmin } from "@/http/auth";
import { doc } from "@/http/openapi";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/lib/logger";
import { ok, okMessage, okPage } from "@/lib/responses";
import {
	AdminProductCharacteristicSchema,
	CharacteristicDataTypeSchema,
	ProductCharacteristicSchema,
} from "@/lib/schemas/entities";
import { CharacteristicListQuery } from "@/lib/schemas/queries";
import {
	OkMessage,
	okPageRes,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas/responses";
import { zInteger, zString } from "@/lib/schemas/t";
import { adminDetail } from "../context";
import {
	createProductCharacteristic,
	deleteProductCharacteristic,
	listProductCharacteristics,
	updateProductCharacteristic,
} from "../services/product-characteristics";

const OptionsBody = z
	.array(
		z.object({
			id: z
				.string()
				.meta({
					description:
						"ID di un'opzione esistente: tenerlo permette di rinominarla senza perdere i valori dei prodotti",
				})
				.optional(),
			value: zString({ maxLength: 100, description: "Valore ammesso" }),
		}),
	)
	.meta({
		description: "Opzioni della lista chiusa, nell'ordine di presentazione",
	});

const unit = () =>
	zString({
		maxLength: 20,
		description: "Unità di misura, solo per il tipo number",
	})
		.nullable()
		.optional();

const AdminProductCharacteristicListResponse = okPageRes(
	AdminProductCharacteristicSchema,
);
const ProductCharacteristicResponse = okRes(ProductCharacteristicSchema);

const Params = z.object({
	characteristicId: z.string().meta({ description: "ID della caratteristica" }),
});

export const CreateProductCharacteristicBody = z.object({
	name: zString({
		minLength: 1,
		maxLength: 100,
		description: "Nome della caratteristica, univoco nel dizionario",
	}),
	dataType: CharacteristicDataTypeSchema,
	unit: unit(),
	options: OptionsBody.optional(),
});

export const UpdateProductCharacteristicBody = z.object({
	name: zString({
		minLength: 1,
		maxLength: 100,
		description: "Nuovo nome della caratteristica",
	}).optional(),
	dataType: CharacteristicDataTypeSchema.optional(),
	unit: unit(),
	options: OptionsBody.optional(),
	confirmAffected: zInteger({
		minimum: 0,
		default: 0,
		description:
			"Numero di prodotti con un valore che l'interfaccia ha mostrato nella conferma. Serve quando la modifica rimuove opzioni in uso o cambia il tipo: se i prodotti coinvolti sono di più, 409 e nulla cambia.",
	}).optional(),
});

export const DeleteProductCharacteristicBody = z.object({
	confirmAffected: zInteger({
		minimum: 0,
		description:
			"Numero di prodotti con un valore che l'interfaccia ha mostrato nella conferma. Se i prodotti coinvolti sono di più, la richiesta è respinta con 409 e nulla viene cancellato.",
	}),
});

export const productCharacteristicsRoutes = new Hono()
	.get(
		"/product-characteristics",
		doc({
			response: withErrors({ 200: AdminProductCharacteristicListResponse }),
			detail: adminDetail(
				"Lista caratteristiche prodotto",
				"Restituisce il dizionario delle caratteristiche, paginato, con le opzioni delle liste chiuse e, per ogni voce e ogni opzione, il numero di prodotti che hanno già un valore.",
			),
		}),
		v("query", CharacteristicListQuery),
		requireAdmin,
		async (c) => {
			const result = await listProductCharacteristics(c.req.valid("query"));
			return send(
				c,
				AdminProductCharacteristicListResponse,
				okPage(result.data, result.pagination),
			);
		},
	)
	.post(
		"/product-characteristics",
		doc({
			response: withConflictErrors({ 200: ProductCharacteristicResponse }),
			detail: adminDetail(
				"Crea caratteristica prodotto",
				"Aggiunge una voce al dizionario. L'unità è ammessa solo per il tipo number, le opzioni solo (e almeno una) per il tipo enum. Il nome deve essere univoco.",
			),
		}),
		v("json", CreateProductCharacteristicBody),
		requireAdmin,
		async (c) => {
			const data = await createProductCharacteristic(c.req.valid("json"));

			logger.info(
				{
					adminId: c.var.user.id,
					characteristicId: data.id,
					characteristicName: data.name,
					dataType: data.dataType,
					action: "product_characteristic_created",
				},
				"Caratteristica prodotto creata",
			);

			return send(c, ProductCharacteristicResponse, ok(data));
		},
	)
	.patch(
		"/product-characteristics/:characteristicId",
		doc({
			response: withConflictErrors({ 200: ProductCharacteristicResponse }),
			detail: adminDetail(
				"Aggiorna caratteristica prodotto",
				"Modifica nome, tipo, unità e opzioni. Le opzioni inviate con il loro id restano le stesse righe anche se cambiano testo, e i valori dei prodotti sopravvivono; quelle esistenti non inviate sono rimosse insieme ai valori che le usano. Un cambio di tipo elimina tutti i valori della caratteristica. Entrambi gli atti richiedono confirmAffected.",
			),
		}),
		v("param", Params),
		v("json", UpdateProductCharacteristicBody),
		requireAdmin,
		async (c) => {
			const body = c.req.valid("json");
			const { updated, deletedValues } = await updateProductCharacteristic({
				characteristicId: c.req.valid("param").characteristicId,
				name: body.name,
				dataType: body.dataType,
				unit: body.unit,
				options: body.options,
				confirmAffected: body.confirmAffected ?? 0,
			});

			logger.info(
				{
					adminId: c.var.user.id,
					characteristicId: updated.id,
					characteristicName: updated.name,
					dataType: updated.dataType,
					deletedValues,
					action: "product_characteristic_updated",
				},
				"Caratteristica prodotto aggiornata",
			);

			return send(c, ProductCharacteristicResponse, ok(updated));
		},
	)
	.delete(
		"/product-characteristics/:characteristicId",
		doc({
			response: withConflictErrors({ 200: OkMessage }),
			detail: adminDetail(
				"Elimina caratteristica prodotto",
				"Elimina una voce dal dizionario insieme alle sue opzioni, alle righe di matrice e ai valori già compilati sui prodotti. Richiede confirmAffected pari almeno al numero di prodotti coinvolti (409 altrimenti); 404 se la voce non esiste.",
			),
		}),
		v("param", Params),
		v("json", DeleteProductCharacteristicBody),
		requireAdmin,
		async (c) => {
			const { deleted, deletedValues } = await deleteProductCharacteristic(
				c.req.valid("param").characteristicId,
				c.req.valid("json").confirmAffected,
			);

			logger.info(
				{
					adminId: c.var.user.id,
					characteristicId: deleted.id,
					characteristicName: deleted.name,
					deletedValues,
					action: "product_characteristic_deleted",
				},
				"Caratteristica prodotto eliminata",
			);

			return send(c, OkMessage, okMessage("Caratteristica eliminata"));
		},
	);
