import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import {
	type AnyMunicipalityHandle,
	bolognaAreaPlacement,
	getAllMunicipalityIds,
	insegnaFor,
	lastNames,
	nationalPlacement,
	pick,
	prefixForSeller,
	SEED_MUNICIPALITIES,
	type SeedMunicipalityHandle,
	streets,
} from "./utils";

// ── Multi-store seller designation ────────────────────────

/** Indici (0-based) dei venditori nazionali che ricevono negozi aggiuntivi. */
const MULTI_STORE_IDXS = [0, 7, 14, 21, 28, 35, 42, 49] as const;

/**
 * Venditori del blocco bolognese con più di un punto vendita: catene locali con
 * una sede in città e una nella cintura.
 */
const BOLOGNA_MULTI_STORE_IDXS = [56, 59, 62, 65, 68, 71, 74, 77] as const;

/**
 * Venditori nazionali che stanno già a Bologna e aprono una filiale nella
 * cintura. Indici pari, perché `pickHandle(idx, 5, 3)` manda a Bologna i pari
 * e a Genova i dispari; scelti fuori da `MULTI_STORE_IDXS` per non accavallarsi.
 */
const BOLOGNA_BRANCH_IDXS = [4, 16, 30] as const;

const SUFFIXES = [
	"Centro",
	"Stazione",
	"Duomo",
	"Porto",
	"Borgo",
	"Quartiere Nuovo",
] as const;

const seedHandles = Object.keys(
	SEED_MUNICIPALITIES,
) as SeedMunicipalityHandle[];

function pickHandle(
	idx: number,
	stride = 1,
	offset = 0,
): SeedMunicipalityHandle {
	return seedHandles[(idx * stride + offset) % seedHandles.length];
}

/** 4 designati con 3 store totali (2 extra), 4 con 2 store totali (1 extra). */
function extraCountFor(rankInDesignated: number): number {
	return rankInDesignated % 2 === 0 ? 2 : 1;
}

interface ExtraStore {
	name: string;
	addressLine1: string;
	municipalityHandle: AnyMunicipalityHandle;
	zipCode: string;
	lat: number;
	lng: number;
}

function addressFor(idx: number, variant: number): string {
	const street = pick(streets, idx, 13, 19 + variant * 7);
	return `${street}, ${((idx + variant * 50) % 150) + 1}`;
}

/** Extra-store data, derived from the original idx of the seller in seedSellers. */
function buildExtraStoresFor(
	rankInDesignated: number,
	idx: number,
): ExtraStore[] {
	const lastName = pick(lastNames, idx, 3, 7);
	const prefix = prefixForSeller(idx);
	// Half of the designated keep the same municipality as the first store (cluster);
	// the other half pick a nearby-ish one from the seed pool.
	const sameCity = rankInDesignated % 2 === 0;
	const handleForExtras = sameCity
		? pickHandle(idx, 5, 3)
		: pickHandle(idx, 5, 7);

	const out: ExtraStore[] = [];
	for (let variant = 0; variant < extraCountFor(rankInDesignated); variant++) {
		const placement = nationalPlacement(handleForExtras, idx, variant + 1);
		out.push({
			name: `${prefix} ${lastName} ${pick(SUFFIXES, idx, 1, variant)}`,
			addressLine1: addressFor(idx, variant),
			municipalityHandle: placement.municipalityHandle,
			zipCode: placement.zipCode,
			lat: placement.lat,
			lng: placement.lng,
		});
	}
	return out;
}

/**
 * Punti vendita aggiuntivi nell'area bolognese. `variant` parte da 1 così il
 * negozio principale (variant 0) resta dov'è: le insegne prendono il nome dalla
 * zona, quindi due filiali dello stesso titolare non collidono mai.
 */
function buildBolognaExtraStoresFor(idx: number, count: number): ExtraStore[] {
	const lastName = pick(lastNames, idx, 3, 7);
	const insegna = insegnaFor(prefixForSeller(idx));

	const out: ExtraStore[] = [];
	for (let variant = 1; variant <= count; variant++) {
		const placement = bolognaAreaPlacement(idx, variant);
		out.push({
			name: `${insegna} ${lastName} ${placement.place}`,
			addressLine1: addressFor(idx, variant),
			municipalityHandle: placement.municipalityHandle,
			zipCode: placement.zipCode,
			lat: placement.lat,
			lng: placement.lng,
		});
	}
	return out;
}

/** Tutti i negozi extra da creare, per indice del venditore. */
function plannedExtraStores(): Map<number, ExtraStore[]> {
	const planned = new Map<number, ExtraStore[]>();

	MULTI_STORE_IDXS.forEach((idx, rank) => {
		planned.set(idx, buildExtraStoresFor(rank, idx));
	});

	// Catene bolognesi: metà con due filiali, metà con una.
	BOLOGNA_MULTI_STORE_IDXS.forEach((idx, rank) => {
		planned.set(idx, buildBolognaExtraStoresFor(idx, rank % 2 === 0 ? 2 : 1));
	});

	// Storici bolognesi che aprono nella cintura.
	for (const idx of BOLOGNA_BRANCH_IDXS) {
		planned.set(idx, buildBolognaExtraStoresFor(idx, 1));
	}

	return planned;
}

export async function seedExtraStores() {
	const planned = plannedExtraStores();
	const designatedIdxs = Array.from(planned.keys());

	// ── Resolve sellerProfileId for each designated seller ─
	const emailFor = (idx: number) => `seller${idx + 1}@test.com`;
	const designatedEmails = designatedIdxs.map(emailFor);

	const rows = await db
		.select({
			email: user.email,
			sellerProfileId: sellerProfile.id,
		})
		.from(sellerProfile)
		.innerJoin(user, eq(user.id, sellerProfile.userId))
		.where(inArray(user.email, designatedEmails));

	if (rows.length === 0) {
		console.log("  ⏭ No designated sellers found, skipping extra stores");
		return;
	}

	const byEmail = new Map(rows.map((r) => [r.email, r.sellerProfileId]));
	const designatedSellerProfileIds = Array.from(byEmail.values());

	// ── Resolve municipality IDs once ─────────────────────────
	const municipalityIds = await getAllMunicipalityIds();

	// ── Per-seller canary: which extra-store names already exist? ─
	// For each designated seller we expect specific store names (built
	// deterministically). We skip only the inserts for names that are
	// already present, so partial state from previous runs is healed.
	const existingNamed = await db
		.select({
			sellerProfileId: store.sellerProfileId,
			name: store.name,
		})
		.from(store)
		.where(inArray(store.sellerProfileId, designatedSellerProfileIds));

	const existingByPair = new Set(
		existingNamed.map((r) => `${r.sellerProfileId}::${r.name}`),
	);

	// ── Build extra store rows (skipping ones already present) ─
	const extraStoreRows: Array<typeof store.$inferInsert> = [];
	let alreadyPresent = 0;

	for (const [idx, extras] of planned) {
		const sellerProfileId = byEmail.get(emailFor(idx));
		if (!sellerProfileId) continue;

		for (const e of extras) {
			if (existingByPair.has(`${sellerProfileId}::${e.name}`)) {
				alreadyPresent++;
				continue;
			}
			extraStoreRows.push({
				sellerProfileId,
				name: e.name,
				description:
					"Punto vendita aggiuntivo dello stesso titolare, con la stessa cura e qualità.",
				addressLine1: e.addressLine1,
				municipalityId: municipalityIds[e.municipalityHandle],
				zipCode: e.zipCode,
				location: { x: e.lng, y: e.lat },
			});
		}
	}

	if (extraStoreRows.length === 0) {
		console.log(
			`  ⏭ Extra stores already seeded (${alreadyPresent} present), skipping`,
		);
		return;
	}

	console.log(
		`  🏪 Seeding ${extraStoreRows.length} extra stores (${alreadyPresent} already present)...`,
	);
	await db.insert(store).values(extraStoreRows);
	console.log(`  ✓ ${extraStoreRows.length} extra stores seeded`);
}
