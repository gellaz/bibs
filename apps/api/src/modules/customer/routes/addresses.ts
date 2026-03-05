import { Elysia, t } from "elysia";
import { getLogger } from "@/lib/logger";
import { PaginationQuery } from "@/lib/pagination";
import { ok, okMessage, okPage } from "@/lib/responses";
import {
	AddressFieldsOptional,
	AddressFieldsRequired,
	CustomerAddressSchema,
	OkMessage,
	okPageRes,
	okRes,
	withErrors,
} from "@/lib/schemas";
import { withCustomer } from "../context";
import {
	createAddress,
	deleteAddress,
	listAddresses,
	updateAddress,
} from "../services/addresses";

export const addressesRoutes = new Elysia()
	.get(
		"/addresses",
		async (ctx) => {
			const { customerProfile: cp, query } = withCustomer(ctx);
			const result = await listAddresses({
				customerProfileId: cp.id,
				...query,
			});
			return okPage(result.data, result.pagination);
		},
		{
			query: PaginationQuery,
			response: withErrors({ 200: okPageRes(CustomerAddressSchema) }),
			detail: {
				summary: "Lista indirizzi",
				description:
					"Restituisce la lista paginata degli indirizzi di spedizione del cliente.",
				tags: ["Customer - Addresses"],
			},
		},
	)
	.post(
		"/addresses",
		async (ctx) => {
			const { customerProfile: cp, body, store, user } = withCustomer(ctx);
			const pino = getLogger(store);

			const data = await createAddress({ customerProfileId: cp.id, ...body });

			pino.info(
				{
					userId: user.id,
					customerProfileId: cp.id,
					addressId: data.id,
					city: data.city,
					isDefault: data.isDefault,
					action: "address_created",
				},
				"Nuovo indirizzo cliente creato",
			);

			return ok(data);
		},
		{
			body: t.Object({
				label: t.Optional(
					t.String({
						maxLength: 50,
						description: "Etichetta (es. 'Casa', 'Ufficio')",
					}),
				),
				recipientName: t.Optional(
					t.String({ maxLength: 100, description: "Nome del destinatario" }),
				),
				phone: t.Optional(
					t.String({
						minLength: 5,
						maxLength: 30,
						description: "Numero di telefono",
					}),
				),
				...AddressFieldsRequired,
				isDefault: t.Optional(
					t.Boolean({ description: "Imposta come indirizzo predefinito" }),
				),
			}),
			response: withErrors({ 200: okRes(CustomerAddressSchema) }),
			detail: {
				summary: "Crea indirizzo",
				description:
					"Aggiunge un nuovo indirizzo di spedizione. Se isDefault=true, gli altri indirizzi vengono impostati come non predefiniti.",
				tags: ["Customer - Addresses"],
			},
		},
	)
	.patch(
		"/addresses/:addressId",
		async (ctx) => {
			const { customerProfile: cp, params, body } = withCustomer(ctx);
			const data = await updateAddress({
				addressId: params.addressId,
				customerProfileId: cp.id,
				...body,
			});
			return ok(data);
		},
		{
			params: t.Object({
				addressId: t.String({ description: "ID dell'indirizzo" }),
			}),
			body: t.Object({
				label: t.Optional(
					t.String({ maxLength: 50, description: "Etichetta" }),
				),
				recipientName: t.Optional(
					t.String({ maxLength: 100, description: "Nome del destinatario" }),
				),
				phone: t.Optional(
					t.String({
						minLength: 5,
						maxLength: 30,
						description: "Numero di telefono",
					}),
				),
				...AddressFieldsOptional,
				isDefault: t.Optional(
					t.Boolean({ description: "Imposta come predefinito" }),
				),
			}),
			response: withErrors({ 200: okRes(CustomerAddressSchema) }),
			detail: {
				summary: "Aggiorna indirizzo",
				description:
					"Aggiorna un indirizzo esistente. Se isDefault=true, gli altri vengono impostati come non predefiniti.",
				tags: ["Customer - Addresses"],
			},
		},
	)
	.delete(
		"/addresses/:addressId",
		async (ctx) => {
			const { customerProfile: cp, params } = withCustomer(ctx);
			await deleteAddress({
				addressId: params.addressId,
				customerProfileId: cp.id,
			});
			return okMessage("Address deleted");
		},
		{
			params: t.Object({
				addressId: t.String({ description: "ID dell'indirizzo" }),
			}),
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina indirizzo",
				description: "Elimina un indirizzo di spedizione del cliente.",
				tags: ["Customer - Addresses"],
			},
		},
	);
