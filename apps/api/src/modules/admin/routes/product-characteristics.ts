import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { CharacteristicListQuery } from "@/lib/queries";
import { ok, okMessage, okPage } from "@/lib/responses";
import {
	AdminProductCharacteristicSchema,
	CharacteristicDataTypeSchema,
	OkMessage,
	okPageRes,
	okRes,
	ProductCharacteristicSchema,
	withConflictErrors,
	withErrors,
} from "@/lib/schemas";
import { withAdmin } from "../context";
import {
	createProductCharacteristic,
	deleteProductCharacteristic,
	listProductCharacteristics,
	updateProductCharacteristic,
} from "../services/product-characteristics";

const OptionsBody = t.Array(
	t.Object({
		id: t.Optional(
			t.String({
				description:
					"ID di un'opzione esistente: tenerlo permette di rinominarla senza perdere i valori dei prodotti",
			}),
		),
		value: t.String({ maxLength: 100, description: "Valore ammesso" }),
	}),
	{ description: "Opzioni della lista chiusa, nell'ordine di presentazione" },
);

export const productCharacteristicsRoutes = new Elysia()
	.get(
		"/product-characteristics",
		async ({ query }) => {
			const result = await listProductCharacteristics(query);
			return okPage(result.data, result.pagination);
		},
		{
			query: CharacteristicListQuery,
			response: withErrors({
				200: okPageRes(AdminProductCharacteristicSchema),
			}),
			detail: {
				summary: "Lista caratteristiche prodotto",
				description:
					"Restituisce il dizionario delle caratteristiche, paginato, con le opzioni delle liste chiuse e, per ogni voce e ogni opzione, il numero di prodotti che hanno già un valore.",
				tags: ["Admin"],
			},
		},
	)
	.post(
		"/product-characteristics",
		async (ctx) => {
			const { body, store, user } = withAdmin(ctx);
			const data = await createProductCharacteristic(body);

			getLogger(store).info(
				{
					adminId: user.id,
					characteristicId: data.id,
					characteristicName: data.name,
					dataType: data.dataType,
					action: "product_characteristic_created",
				},
				"Caratteristica prodotto creata",
			);

			return ok(data);
		},
		{
			body: t.Object({
				name: t.String({
					minLength: 1,
					maxLength: 100,
					description: "Nome della caratteristica, univoco nel dizionario",
				}),
				dataType: CharacteristicDataTypeSchema,
				unit: t.Optional(
					t.Nullable(
						t.String({
							maxLength: 20,
							description: "Unità di misura, solo per il tipo number",
						}),
					),
				),
				options: t.Optional(OptionsBody),
			}),
			response: withConflictErrors({ 200: okRes(ProductCharacteristicSchema) }),
			detail: {
				summary: "Crea caratteristica prodotto",
				description:
					"Aggiunge una voce al dizionario. L'unità è ammessa solo per il tipo number, le opzioni solo (e almeno una) per il tipo enum. Il nome deve essere univoco.",
				tags: ["Admin"],
			},
		},
	)
	.patch(
		"/product-characteristics/:characteristicId",
		async (ctx) => {
			const { params, body, store, user } = withAdmin(ctx);
			const { updated, deletedValues } = await updateProductCharacteristic({
				characteristicId: params.characteristicId,
				name: body.name,
				dataType: body.dataType,
				unit: body.unit,
				options: body.options,
				confirmAffected: body.confirmAffected ?? 0,
			});

			getLogger(store).info(
				{
					adminId: user.id,
					characteristicId: updated.id,
					characteristicName: updated.name,
					dataType: updated.dataType,
					deletedValues,
					action: "product_characteristic_updated",
				},
				"Caratteristica prodotto aggiornata",
			);

			return ok(updated);
		},
		{
			params: t.Object({
				characteristicId: t.String({ description: "ID della caratteristica" }),
			}),
			body: t.Object({
				name: t.Optional(
					t.String({
						minLength: 1,
						maxLength: 100,
						description: "Nuovo nome della caratteristica",
					}),
				),
				dataType: t.Optional(CharacteristicDataTypeSchema),
				unit: t.Optional(
					t.Nullable(
						t.String({
							maxLength: 20,
							description: "Unità di misura, solo per il tipo number",
						}),
					),
				),
				options: t.Optional(OptionsBody),
				confirmAffected: t.Optional(
					t.Integer({
						minimum: 0,
						default: 0,
						description:
							"Numero di prodotti con un valore che l'interfaccia ha mostrato nella conferma. Serve quando la modifica rimuove opzioni in uso o cambia il tipo: se i prodotti coinvolti sono di più, 409 e nulla cambia.",
					}),
				),
			}),
			response: withConflictErrors({ 200: okRes(ProductCharacteristicSchema) }),
			detail: {
				summary: "Aggiorna caratteristica prodotto",
				description:
					"Modifica nome, tipo, unità e opzioni. Le opzioni inviate con il loro id restano le stesse righe anche se cambiano testo, e i valori dei prodotti sopravvivono; quelle esistenti non inviate sono rimosse insieme ai valori che le usano. Un cambio di tipo elimina tutti i valori della caratteristica. Entrambi gli atti richiedono confirmAffected.",
				tags: ["Admin"],
			},
		},
	)
	.delete(
		"/product-characteristics/:characteristicId",
		async (ctx) => {
			const { params, body, store, user } = withAdmin(ctx);
			const { deleted, deletedValues } = await deleteProductCharacteristic(
				params.characteristicId,
				body.confirmAffected,
			);

			getLogger(store).info(
				{
					adminId: user.id,
					characteristicId: deleted.id,
					characteristicName: deleted.name,
					deletedValues,
					action: "product_characteristic_deleted",
				},
				"Caratteristica prodotto eliminata",
			);

			return okMessage("Product characteristic deleted");
		},
		{
			params: t.Object({
				characteristicId: t.String({ description: "ID della caratteristica" }),
			}),
			body: t.Object({
				confirmAffected: t.Integer({
					minimum: 0,
					description:
						"Numero di prodotti con un valore che l'interfaccia ha mostrato nella conferma. Se i prodotti coinvolti sono di più, la richiesta è respinta con 409 e nulla viene cancellato.",
				}),
			}),
			response: withConflictErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina caratteristica prodotto",
				description:
					"Elimina una voce dal dizionario insieme alle sue opzioni, alle righe di matrice e ai valori già compilati sui prodotti. Richiede confirmAffected pari almeno al numero di prodotti coinvolti (409 altrimenti); 404 se la voce non esiste.",
				tags: ["Admin"],
			},
		},
	);
