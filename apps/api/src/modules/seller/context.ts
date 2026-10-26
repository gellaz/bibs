import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { product, storeProduct } from "@/db/schemas/product";
import { store as storeTable } from "@/db/schemas/store";
import {
	type AccessCtx,
	getEmployeeAssignedStoreIds,
} from "@/domain/sellers/access";
import { ServiceError } from "@/lib/errors";

/**
 * Verifies that a product belongs to the given seller profile.
 * Throws 404 if not found.
 */
export async function ensureProductOwnership(
	productId: string,
	sellerProfileId: string,
) {
	const p = await db.query.product.findFirst({
		where: and(
			eq(product.id, productId),
			eq(product.sellerProfileId, sellerProfileId),
		),
	});
	if (!p) throw new ServiceError(404, "Prodotto non trovato");
	return p;
}

/**
 * Verifies that a store belongs to the given seller profile.
 * Throws 404 if not found.
 */
export async function ensureStoreOwnership(
	storeId: string,
	sellerProfileId: string,
) {
	const s = await db.query.store.findFirst({
		where: and(
			eq(storeTable.id, storeId),
			eq(storeTable.sellerProfileId, sellerProfileId),
			isNull(storeTable.deletedAt),
		),
	});
	if (!s) throw new ServiceError(404, "Negozio non trovato");
	return s;
}

/**
 * Throws 404 (owner) o 403 (employee) se il chiamante non può operare sullo store.
 * Owner: verifica via ensureStoreOwnership (404 se non appartiene al seller o cancellato).
 * Employee: 403 se storeId non in assignedStoreIds, anche se lo store esiste e appartiene al seller.
 */
export async function ensureStoreAccess(
	storeId: string,
	ctx: AccessCtx,
): Promise<void> {
	if (ctx.isOwner) {
		await ensureStoreOwnership(storeId, ctx.sellerProfileId);
		return;
	}
	const assigned = await getEmployeeAssignedStoreIds(
		ctx.userId,
		ctx.sellerProfileId,
	);
	if (!assigned.includes(storeId)) {
		throw new ServiceError(403, "Accesso negato a questo negozio");
	}
}

/**
 * Product-level sibling of {@link ensureStoreAccess}.
 * Owner: 404 se il prodotto non appartiene al seller (qualunque store, anche
 * non assegnato a nessuno).
 * Employee: 404 se non è del seller; 403 se il prodotto non è in stock in
 * nessuno degli store assegnati al chiamante.
 */
export async function ensureProductAccess(
	productId: string,
	ctx: AccessCtx,
): Promise<void> {
	await ensureProductOwnership(productId, ctx.sellerProfileId);
	if (ctx.isOwner) return;
	const assigned = await getEmployeeAssignedStoreIds(
		ctx.userId,
		ctx.sellerProfileId,
	);
	const rows = await db.query.storeProduct.findMany({
		where: eq(storeProduct.productId, productId),
		columns: { storeId: true },
	});
	if (!rows.some((r) => assigned.includes(r.storeId))) {
		throw new ServiceError(403, "Accesso negato a questo prodotto");
	}
}

/**
 * Asserts the caller is the owner (not an employee).
 * Throws 403 if not.
 */
export function requireOwner(isOwner: boolean) {
	if (!isOwner)
		throw new ServiceError(
			403,
			"Solo il titolare può eseguire questa operazione",
		);
}
