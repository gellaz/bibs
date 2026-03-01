import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { customerAddress } from "@/db/schemas/address";
import { ServiceError } from "@/lib/errors";
import { parsePagination } from "@/lib/pagination";

interface ListAddressesParams {
	customerProfileId: string;
	page?: number;
	limit?: number;
}

export async function listAddresses(params: ListAddressesParams) {
	const { customerProfileId } = params;
	const { page, limit, offset } = parsePagination(params);

	const [data, [{ total }]] = await Promise.all([
		db.query.customerAddress.findMany({
			where: eq(customerAddress.customerProfileId, customerProfileId),
			limit,
			offset,
		}),
		db
			.select({ total: count() })
			.from(customerAddress)
			.where(eq(customerAddress.customerProfileId, customerProfileId)),
	]);

	return { data, pagination: { page, limit, total } };
}

interface CreateAddressParams {
	customerProfileId: string;
	label?: string;
	recipientName?: string;
	phone?: string;
	addressLine1: string;
	addressLine2?: string;
	city: string;
	zipCode: string;
	province?: string;
	country?: string;
	location?: { x: number; y: number };
	isDefault?: boolean;
}

export async function createAddress(params: CreateAddressParams) {
	const { customerProfileId, isDefault = false, ...addressData } = params;

	const [created] = await db.transaction(async (tx) => {
		if (isDefault) {
			await tx
				.update(customerAddress)
				.set({ isDefault: false })
				.where(eq(customerAddress.customerProfileId, customerProfileId));
		}

		return tx
			.insert(customerAddress)
			.values({
				customerProfileId,
				...addressData,
				isDefault,
			})
			.returning();
	});

	return created;
}

interface UpdateAddressParams {
	addressId: string;
	customerProfileId: string;
	label?: string;
	recipientName?: string;
	phone?: string;
	addressLine1?: string;
	addressLine2?: string;
	city?: string;
	zipCode?: string;
	province?: string;
	country?: string;
	location?: { x: number; y: number };
	isDefault?: boolean;
}

export async function updateAddress(params: UpdateAddressParams) {
	const { addressId, customerProfileId, ...data } = params;

	const [updated] = await db.transaction(async (tx) => {
		if (data.isDefault) {
			await tx
				.update(customerAddress)
				.set({ isDefault: false })
				.where(eq(customerAddress.customerProfileId, customerProfileId));
		}

		return tx
			.update(customerAddress)
			.set(data)
			.where(
				and(
					eq(customerAddress.id, addressId),
					eq(customerAddress.customerProfileId, customerProfileId),
				),
			)
			.returning();
	});

	if (!updated) throw new ServiceError(404, "Address not found");
	return updated;
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
