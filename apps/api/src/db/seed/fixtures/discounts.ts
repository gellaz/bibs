import { and, asc, count, eq, inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import {
	type DiscountStatus,
	discount,
	discountProduct,
} from "@/db/schemas/discount";
import { product } from "@/db/schemas/product";
import { sellerProfile } from "@/db/schemas/seller";
import { BOLOGNA_BLOCK_START, pick } from "./utils";

/**
 * Promozioni dei venditori. Senza queste righe `discounts` resta vuota, e con
 * essa il filtro "In offerta" del customer (che mostra il conteggio a zero e si
 * disabilita) e la colonna promo del back-office: due funzionalità spedite che
 * in sviluppo non si erano mai viste accese.
 *
 * Gli stati sono mescolati di proposito. Il customer deve vedere solo le
 * promozioni correnti, quindi servono anche quelle che *non* deve vedere —
 * programmate, scadute, in pausa, archiviate — o non si scopre mai se il
 * filtro le esclude davvero.
 */

const DAY = 86400000;

/** Che forma ha una promozione nel tempo. */
type DiscountKind =
	| "current" // attiva e in corso, con una data di fine
	| "current_open" // attiva e in corso, senza scadenza
	| "scheduled" // attiva ma non ancora cominciata
	| "expired" // attiva ma già finita
	| "paused"
	| "archived";

/**
 * Ciclo deterministico degli stati: 13 correnti su 20 (~65%), poi 2
 * programmate, 2 scadute, 2 in pausa e 1 archiviata. Al customer arrivano solo
 * le prime tredici.
 */
const KIND_CYCLE: readonly DiscountKind[] = [
	"current",
	"current",
	"current_open",
	"current",
	"scheduled",
	"current",
	"current_open",
	"expired",
	"current",
	"paused",
	"current",
	"current_open",
	"archived",
	"current",
	"scheduled",
	"current",
	"paused",
	"current_open",
	"current",
	"expired",
];

const TITLES = [
	"Saldi di fine stagione",
	"Settimana del gusto",
	"Sottocosto",
	"Promo di primavera",
	"Offerta del mese",
	"Black Friday",
	"Liquidazione scaffali",
	"Prezzi piccoli",
	"Fuori tutto",
	"Il meglio in offerta",
	"Sconti di quartiere",
	"Occasioni del sabato",
] as const;

const PERCENTS = [10, 15, 20, 25, 30, 35, 40, 50] as const;

interface Period {
	startsAt: Date;
	endsAt: Date | null;
	status: DiscountStatus;
}

function periodFor(kind: DiscountKind, k: number, now: number): Period {
	switch (kind) {
		case "current":
			return {
				startsAt: new Date(now - (3 + (k % 28)) * DAY),
				endsAt: new Date(now + (5 + (k % 55)) * DAY),
				status: "active",
			};
		case "current_open":
			return {
				startsAt: new Date(now - (2 + (k % 20)) * DAY),
				endsAt: null,
				status: "active",
			};
		case "scheduled": {
			const startsAt = new Date(now + (3 + (k % 18)) * DAY);
			return {
				startsAt,
				endsAt: new Date(startsAt.getTime() + 14 * DAY),
				status: "active",
			};
		}
		case "expired":
			return {
				startsAt: new Date(now - (60 + (k % 30)) * DAY),
				endsAt: new Date(now - (5 + (k % 16)) * DAY),
				status: "active",
			};
		case "paused":
			return {
				startsAt: new Date(now - (10 + (k % 12)) * DAY),
				endsAt: new Date(now + (20 + (k % 40)) * DAY),
				status: "paused",
			};
		case "archived":
			return {
				startsAt: new Date(now - (120 + (k % 40)) * DAY),
				endsAt: new Date(now - (90 + (k % 20)) * DAY),
				status: "archived",
			};
	}
}

/**
 * Quante promozioni ha un venditore. Un terzo non ne ha nessuna — è lo stato
 * in cui si apre la pagina promozioni la prima volta. Il blocco bolognese ne ha
 * di più: è l'area che si guarda in demo.
 */
function discountCountFor(rank: number, sellerIdx: number): number {
	const m = rank % 10;
	if (sellerIdx >= BOLOGNA_BLOCK_START) {
		if (m < 2) return 0;
		if (m < 5) return 1;
		if (m < 8) return 2;
		return 3;
	}
	if (m < 3) return 0;
	if (m < 7) return 1;
	if (m < 9) return 2;
	return 3;
}

/**
 * Prodotti di una promozione: una finestra contigua di 3–12 titoli sul catalogo
 * del venditore, che parte cinque posizioni più avanti a ogni promozione.
 *
 * La finestra è più lunga del passo, quindi due promozioni consecutive dello
 * stesso venditore condividono qualche prodotto — ed è voluto: è il caso che
 * manda in esecuzione l'`ORDER BY percent DESC` di `getBestActiveDiscount`,
 * cioè "vince lo sconto più alto".
 *
 * Contigua e non a passo, perché un passo che condivide un fattore con la
 * lunghezza del catalogo (3 su 30 prodotti) ripassa sempre sulle stesse voci e
 * la promozione finirebbe con meno prodotti del previsto, in silenzio. Il 7
 * sulle taglie è lì per lo stesso motivo: con un 5 uscivano solo 3 o 8.
 */
function productSliceFor(
	productIds: readonly string[],
	discountIdx: number,
): string[] {
	const size = Math.min(productIds.length, 3 + ((discountIdx * 7) % 10));
	const start = (discountIdx * 5) % productIds.length;
	const out: string[] = [];
	for (let j = 0; j < size; j++) {
		out.push(productIds[(start + j) % productIds.length]);
	}
	return out;
}

const CHUNK = 500;

function chunked<T>(arr: T[], size = CHUNK): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) {
		out.push(arr.slice(i, i + size));
	}
	return out;
}

export async function seedDiscounts() {
	// ── Canary ────────────────────────────────────────────
	const [{ value: existing }] = await db
		.select({ value: count() })
		.from(discount);
	if (existing > 0) {
		console.log("  ⏭ Discounts already seeded, skipping");
		return;
	}

	// ── Venditori attivi ──────────────────────────────────
	const sellerRows = await db
		.select({ email: user.email, sellerProfileId: sellerProfile.id })
		.from(sellerProfile)
		.innerJoin(user, eq(user.id, sellerProfile.userId))
		.where(
			and(
				like(user.email, "seller%@test.com"),
				eq(sellerProfile.onboardingStatus, "active"),
			),
		)
		.orderBy(asc(user.email));

	if (sellerRows.length === 0) {
		console.log("  ⏭ No active sellers found, skipping discounts");
		return;
	}

	// ── Prodotti scontabili ───────────────────────────────
	// Solo gli attivi: su un prodotto in cestino o disabilitato lo sconto non
	// arriverebbe comunque in vetrina.
	const sellerProfileIds = sellerRows.map((s) => s.sellerProfileId);
	const productRows = await db
		.select({ id: product.id, sellerProfileId: product.sellerProfileId })
		.from(product)
		.where(
			and(
				inArray(product.sellerProfileId, sellerProfileIds),
				eq(product.status, "active"),
			),
		)
		.orderBy(asc(product.sellerProfileId), asc(product.id));

	if (productRows.length === 0) {
		console.log("  ⏭ No active products found, skipping discounts");
		return;
	}

	const productsBySeller = new Map<string, string[]>();
	for (const r of productRows) {
		const arr = productsBySeller.get(r.sellerProfileId) ?? [];
		arr.push(r.id);
		productsBySeller.set(r.sellerProfileId, arr);
	}

	// ── Costruzione ───────────────────────────────────────
	interface Plan {
		row: typeof discount.$inferInsert;
		kind: DiscountKind;
		productIds: string[];
	}

	const plans: Plan[] = [];
	const now = Date.now();
	let k = 0;

	sellerRows.forEach((s, rank) => {
		const match = s.email.match(/^seller(\d+)@test\.com$/);
		if (!match) return;
		const sellerIdx = Number.parseInt(match[1], 10) - 1;

		const productIds = productsBySeller.get(s.sellerProfileId) ?? [];
		if (productIds.length === 0) return;

		const howMany = discountCountFor(rank, sellerIdx);
		for (let d = 0; d < howMany; d++) {
			const kind = KIND_CYCLE[k % KIND_CYCLE.length];
			const { startsAt, endsAt, status } = periodFor(kind, k, now);

			plans.push({
				row: {
					sellerProfileId: s.sellerProfileId,
					title: pick(TITLES, k, 1),
					percent: pick(PERCENTS, k, 3, 1),
					startsAt,
					endsAt,
					status,
				},
				kind,
				productIds: productSliceFor(productIds, d + rank),
			});
			k++;
		}
	});

	if (plans.length === 0) {
		console.log("  ⏭ Nothing to discount, skipping");
		return;
	}

	console.log(
		`  🏷️ Seeding ${plans.length} discounts across ${sellerRows.length} sellers...`,
	);

	// ── Inserimento ───────────────────────────────────────
	// Le righe tornano nello stesso ordine in cui sono state passate, chunk per
	// chunk: è così che si risale dal piano all'id appena creato.
	const insertedIds: string[] = [];
	for (const chunk of chunked(plans.map((p) => p.row))) {
		const inserted = await db
			.insert(discount)
			.values(chunk)
			.returning({ id: discount.id });
		insertedIds.push(...inserted.map((r) => r.id));
	}

	const links: Array<typeof discountProduct.$inferInsert> = [];
	plans.forEach((plan, i) => {
		for (const productId of plan.productIds) {
			links.push({ discountId: insertedIds[i], productId });
		}
	});

	for (const chunk of chunked(links)) {
		await db.insert(discountProduct).values(chunk);
	}

	const liveProducts = new Set(
		plans
			.filter((p) => p.kind === "current" || p.kind === "current_open")
			.flatMap((p) => p.productIds),
	);

	console.log(
		`  ✓ ${plans.length} discounts, ${links.length} product links (${liveProducts.size} products in offerta adesso)`,
	);
}
