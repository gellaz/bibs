import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
	type ProductAuditAction,
	productAuditLog,
} from "@/db/schemas/product-audit-log";

export interface RecordAuditParams {
	productId: string;
	actorUserId: string | null;
	action: ProductAuditAction;
	metadata?: Record<string, unknown>;
}

// Drizzle non esporta un tipo Transaction generico user-friendly: usiamo un tipo
// permissivo. La type-safety vera è data dal `db.insert(productAuditLog).values(...)`.
type Tx = PgTransaction<any, any, ExtractTablesWithRelations<any>> | typeof db;

export async function recordProductAudit(
	params: RecordAuditParams,
	tx: Tx = db,
): Promise<void> {
	await tx.insert(productAuditLog).values({
		productId: params.productId,
		actorUserId: params.actorUserId,
		action: params.action,
		metadata: params.metadata ?? null,
	});
}

export async function recordProductAuditBatch(
	entries: RecordAuditParams[],
	tx: Tx = db,
): Promise<void> {
	if (entries.length === 0) return;
	await tx.insert(productAuditLog).values(
		entries.map((e) => ({
			productId: e.productId,
			actorUserId: e.actorUserId,
			action: e.action,
			metadata: e.metadata ?? null,
		})),
	);
}
