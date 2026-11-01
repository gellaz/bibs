import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { customerAddress } from "@/db/schemas/address";
import { ServiceError } from "@/lib/errors";
import {
	municipalityCompactWith,
	type RawMunicipalityCompact,
	toMunicipalityCompact,
} from "@/lib/municipality";
import { parsePagination } from "@/lib/pagination";

function reshapeAddress<T extends { municipality: RawMunicipalityCompact }>({
	municipality,
	...rest
}: T) {
	return { ...rest, municipality: toMunicipalityCompact(municipality) };
}

const municipalityWith = { municipality: municipalityCompactWith } as const;

interface ListAddressesParams {
	customerProfileId: string;
	page?: number;
	limit?: number;
}

export async function listAddresses(params: ListAddressesParams) {
	const { customerProfileId } = params;
	const { page, limit, offset } = parsePagination(params);

	const [raw, [{ total }]] = await Promise.all([
		db.query.customerAddress.findMany({
			where: eq(customerAddress.customerProfileId, customerProfileId),
			with: municipalityWith,
			// Stable total order: without it, LIMIT/OFFSET paging over an unordered
			// heap scan can repeat or skip rows across pages. Default first, then
			// newest, id as the deterministic tiebreaker.
			orderBy: (a, { asc, desc }) => [
				desc(a.isDefault),
				desc(a.createdAt),
				asc(a.id),
			],
			limit,
			offset,
		}),
		db
			.select({ total: count() })
			.from(customerAddress)
			.where(eq(customerAddress.customerProfileId, customerProfileId)),
	]);

	const data = raw.map(reshapeAddress);

	return { data, pagination: { page, limit, total } };
}

interface CreateAddressParams {
	customerProfileId: string;
	label?: string;
	recipientName?: string;
	phone?: string;
	addressLine1: string;
	addressLine2?: string;
	municipalityId: string;
	zipCode: string;
	country?: string;
	location?: { x: number; y: number };
	isDefault?: boolean;
}

export async function createAddress(params: CreateAddressParams) {
	const {
		customerProfileId,
		isDefault = false,
		phone,
		...addressData
	} = params;

	const created = await db.transaction(async (tx) => {
		if (isDefault) {
			await tx
				.update(customerAddress)
				.set({ isDefault: false })
				.where(eq(customerAddress.customerProfileId, customerProfileId));
		}

		const [inserted] = await tx
			.insert(customerAddress)
			.values({
				customerProfileId,
				...addressData,
				phone: phone || null,
				isDefault,
			})
			.returning();

		return inserted;
	});

	const addr = await db.query.customerAddress.findFirst({
		where: eq(customerAddress.id, created.id),
		with: municipalityWith,
	});

	if (!addr)
		throw new ServiceError(500, "Indirizzo non trovato dopo il salvataggio");
	return reshapeAddress(addr);
}

interface UpdateAddressParams {
	addressId: string;
	customerProfileId: string;
	label?: string;
	recipientName?: string;
	phone?: string;
	addressLine1?: string;
	addressLine2?: string;
	municipalityId?: string;
	zipCode?: string;
	country?: string;
	location?: { x: number; y: number };
	isDefault?: boolean;
}

export async function updateAddress(params: UpdateAddressParams) {
	const { addressId, customerProfileId, phone, ...data } = params;

	const updated = await db.transaction(async (tx) => {
		if (data.isDefault) {
			await tx
				.update(customerAddress)
				.set({ isDefault: false })
				.where(eq(customerAddress.customerProfileId, customerProfileId));
		}

		const [result] = await tx
			.update(customerAddress)
			// `""` cancella il telefono; `undefined` lo lascia com'è.
			.set({ ...data, ...(phone !== undefined && { phone: phone || null }) })
			.where(
				and(
					eq(customerAddress.id, addressId),
					eq(customerAddress.customerProfileId, customerProfileId),
				),
			)
			.returning();

		// Dentro la transazione: il 404 annulla anche l'azzeramento del predefinito.
		if (!result) throw new ServiceError(404, "Indirizzo non trovato");
		return result;
	});

	const addr = await db.query.customerAddress.findFirst({
		where: eq(customerAddress.id, updated.id),
		with: municipalityWith,
	});

	if (!addr)
		throw new ServiceError(500, "Indirizzo non trovato dopo l'aggiornamento");
	return reshapeAddress(addr);
}

interface DeleteAddressParams {
	addressId: string;
	customerProfileId: string;
}

export async function deleteAddress(params: DeleteAddressParams) {
	const { addressId, customerProfileId } = params;

	const [deleted] = await db
		.delete(customerAddress)
		.where(
			and(
				eq(customerAddress.id, addressId),
				eq(customerAddress.customerProfileId, customerProfileId),
			),
		)
		.returning();

	if (!deleted) throw new ServiceError(404, "Indirizzo non trovato");
	return deleted;
}
