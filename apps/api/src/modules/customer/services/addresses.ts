import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { customerAddress } from "@/db/schemas/address";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";

function reshapeAddress<
	T extends {
		municipality: {
			id: string;
			name: string;
			province: { acronym: string };
		};
	},
>(
	addr: T,
): Omit<T, "municipality"> & {
	municipality: { id: string; name: string; provinceAcronym: string };
} {
	const { municipality, ...rest } = addr;
	return {
		...rest,
		municipality: {
			id: municipality.id,
			name: municipality.name,
			provinceAcronym: municipality.province.acronym,
		},
	};
}

const municipalityWith = {
	municipality: {
		columns: { id: true as const, name: true as const },
		with: { province: { columns: { acronym: true as const } } },
	},
} as const;

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
	const { customerProfileId, isDefault = false, ...addressData } = params;

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
				isDefault,
			})
			.returning();

		return inserted;
	});

	const addr = await db.query.customerAddress.findFirst({
		where: eq(customerAddress.id, created.id),
		with: municipalityWith,
	});

	if (!addr) throw new ServiceError(500, "Address not found after insert");
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
	const { addressId, customerProfileId, ...data } = params;

	const updated = await db.transaction(async (tx) => {
		if (data.isDefault) {
			await tx
				.update(customerAddress)
				.set({ isDefault: false })
				.where(eq(customerAddress.customerProfileId, customerProfileId));
		}

		const [result] = await tx
			.update(customerAddress)
			.set(data)
			.where(
				and(
					eq(customerAddress.id, addressId),
					eq(customerAddress.customerProfileId, customerProfileId),
				),
			)
			.returning();

		return result;
	});

	if (!updated) throw new ServiceError(404, "Address not found");

	const addr = await db.query.customerAddress.findFirst({
		where: eq(customerAddress.id, updated.id),
		with: municipalityWith,
	});

	if (!addr) throw new ServiceError(500, "Address not found after update");
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

	if (!deleted) throw new ServiceError(404, "Address not found");
	return deleted;
}
