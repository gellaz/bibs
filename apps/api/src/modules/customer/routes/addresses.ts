import { Hono } from "hono";
import { z } from "zod";
import { requireCustomer } from "@/http/auth";
import { doc } from "@/http/openapi";
import { ok, okMessage, okPage } from "@/http/responses";
import { send } from "@/http/send";
import { v } from "@/http/validator";
import { logger } from "@/infra/logger";
import {
	AddressFieldsOptional,
	AddressFieldsRequired,
	CustomerAddressSchema,
} from "@/schemas/entities";
import { PaginationQuery } from "@/schemas/pagination";
import {
	OkMessage,
	okPageRes,
	okRes,
	withConflictErrors,
	withErrors,
} from "@/schemas/responses";
import { zString } from "@/schemas/t";
import { customerSecurity } from "../context";
import {
	createAddress,
	deleteAddress,
	listAddresses,
	updateAddress,
} from "../services/addresses";

/**
 * Opzionale, ma se c'è almeno 5 caratteri. La stringa vuota lo cancella (il
 * service la salva come `null`).
 */
const AddressPhone = zString({
	maxLength: 30,
	pattern: "^(.{5,})?$",
	description: "Numero di telefono; stringa vuota per rimuoverlo",
});

const AddressPage = okPageRes(CustomerAddressSchema);
const AddressResponse = okRes(CustomerAddressSchema);
const AddressParams = z.object({
	addressId: z.string().meta({ description: "ID dell'indirizzo" }),
});

export const addressesRoutes = new Hono()
	.get(
		"/addresses",
		doc({
			response: withErrors({ 200: AddressPage }),
			detail: {
				summary: "Lista indirizzi",
				description:
					"Restituisce la lista paginata degli indirizzi di spedizione del cliente.",
				tags: ["Customer - Addresses"],
				...customerSecurity,
			},
		}),
		v("query", PaginationQuery),
		requireCustomer,
		async (c) => {
			const result = await listAddresses({
				customerProfileId: c.var.customerProfile.id,
				...c.req.valid("query"),
			});
			return send(c, AddressPage, okPage(result.data, result.pagination));
		},
	)
	.post(
		"/addresses",
		doc({
			response: withConflictErrors({ 200: AddressResponse }),
			detail: {
				summary: "Crea indirizzo",
				description:
					"Aggiunge un nuovo indirizzo di spedizione. Se isDefault=true, gli altri indirizzi vengono impostati come non predefiniti.",
				tags: ["Customer - Addresses"],
				...customerSecurity,
			},
		}),
		v(
			"json",
			z.object({
				label: zString({
					maxLength: 50,
					description: "Etichetta (es. 'Casa', 'Ufficio')",
				}).optional(),
				recipientName: zString({
					maxLength: 100,
					description: "Nome del destinatario",
				}).optional(),
				phone: AddressPhone.optional(),
				...AddressFieldsRequired,
				isDefault: z
					.boolean()
					.meta({ description: "Imposta come indirizzo predefinito" })
					.optional(),
			}),
		),
		requireCustomer,
		async (c) => {
			const cp = c.var.customerProfile;
			const data = await createAddress({
				customerProfileId: cp.id,
				...c.req.valid("json"),
			});

			logger.info(
				{
					userId: c.var.user.id,
					customerProfileId: cp.id,
					addressId: data.id,
					municipalityId: data.municipalityId,
					isDefault: data.isDefault,
					action: "address_created",
				},
				"Nuovo indirizzo cliente creato",
			);

			return send(c, AddressResponse, ok(data));
		},
	)
	.patch(
		"/addresses/:addressId",
		doc({
			response: withConflictErrors({ 200: AddressResponse }),
			detail: {
				summary: "Aggiorna indirizzo",
				description:
					"Aggiorna un indirizzo esistente. Se isDefault=true, gli altri vengono impostati come non predefiniti.",
				tags: ["Customer - Addresses"],
				...customerSecurity,
			},
		}),
		v("param", AddressParams),
		v(
			"json",
			z.object({
				label: zString({ maxLength: 50, description: "Etichetta" }).optional(),
				recipientName: zString({
					maxLength: 100,
					description: "Nome del destinatario",
				}).optional(),
				phone: AddressPhone.optional(),
				...AddressFieldsOptional,
				isDefault: z
					.boolean()
					.meta({ description: "Imposta come predefinito" })
					.optional(),
			}),
		),
		requireCustomer,
		async (c) => {
			const data = await updateAddress({
				addressId: c.req.valid("param").addressId,
				customerProfileId: c.var.customerProfile.id,
				...c.req.valid("json"),
			});
			return send(c, AddressResponse, ok(data));
		},
	)
	.delete(
		"/addresses/:addressId",
		doc({
			response: withErrors({ 200: OkMessage }),
			detail: {
				summary: "Elimina indirizzo",
				description: "Elimina un indirizzo di spedizione del cliente.",
				tags: ["Customer - Addresses"],
				...customerSecurity,
			},
		}),
		v("param", AddressParams),
		requireCustomer,
		async (c) => {
			await deleteAddress({
				addressId: c.req.valid("param").addressId,
				customerProfileId: c.var.customerProfile.id,
			});
			return send(c, OkMessage, okMessage("Indirizzo eliminato"));
		},
	);
