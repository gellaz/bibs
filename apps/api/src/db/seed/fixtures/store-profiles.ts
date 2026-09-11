import { asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { municipality } from "@/db/schemas/location";
import { sellerProfile } from "@/db/schemas/seller";
import { store, storePhoneNumber } from "@/db/schemas/store";
import { storeCategory } from "@/db/schemas/store-category";
import { storeImage } from "@/db/schemas/store-image";
import { config } from "@/lib/config";
import { validateOpeningHours } from "@/lib/opening-hours";
import { businessPrefixes } from "./sellers";
import {
	ISTAT_TO_SEED_HANDLE,
	pick,
	SEED_MUNICIPALITY_PHONE_PREFIX,
} from "./utils";

/**
 * Profilo pubblico dei negozi: categoria, orari di apertura, telefoni, sito e
 * descrizione estesa. Gira dopo `seedStoreImages` (che mette la copertina in
 * posizione 0) e aggiunge le foto di vetrina in coda.
 *
 * Tre livelli di completezza, assegnati in modo deterministico, perché in
 * sviluppo servono tutti e tre gli stati:
 *
 * - `full`  (~40%) — orari, due telefoni, sito, descrizione lunga, 5 foto
 * - `basic` (~30%) — orari, un telefono, descrizione breve, 3 foto
 * - `bare`  (~30%) — come esce da `seedSellers`: nessun orario, nessun contatto
 *
 * La categoria invece va a tutti (è un asse diverso dalla completezza del
 * profilo): senza di essa i filtri per categoria su /stores non hanno alcuna
 * corrispondenza. Resta fuori solo `Ottica`, che non ha una `store_categories`
 * corrispondente — e tiene vivo lo stato "negozio senza categoria".
 */

// ── Orari: archetipi per tipo di negozio ──────────────────

/** Fasce di un giorno come coppie [apertura, chiusura], in HH:mm. */
type DayRanges = Array<[string, string]>;

interface HoursArchetype {
	id: string;
	/**
	 * Fasce per giorno (0=Lun … 6=Dom). **I giorni di chiusura si omettono**:
	 * lo schema richiede almeno una fascia per ogni giorno presente, quindi un
	 * giorno con `slots: []` è una forma che il seller non potrebbe mai salvare.
	 */
	days: Record<number, DayRanges>;
}

/** Alimentari, macellerie, gastronomie: mattina e pomeriggio, mercoledì corto. */
const BOTTEGA: HoursArchetype = {
	id: "bottega",
	days: {
		0: [
			["07:30", "13:00"],
			["16:00", "19:30"],
		],
		1: [
			["07:30", "13:00"],
			["16:00", "19:30"],
		],
		2: [["07:30", "13:00"]], // chiusura infrasettimanale del pomeriggio
		3: [
			["07:30", "13:00"],
			["16:00", "19:30"],
		],
		4: [
			["07:30", "13:00"],
			["16:00", "19:30"],
		],
		5: [
			["07:30", "13:00"],
			["16:00", "19:30"],
		],
	},
};

/** Panifici e pasticcerie: aperti la domenica mattina, chiusi il lunedì. */
const FORNO: HoursArchetype = {
	id: "forno",
	days: {
		1: [
			["07:00", "13:30"],
			["16:30", "19:30"],
		],
		2: [
			["07:00", "13:30"],
			["16:30", "19:30"],
		],
		3: [
			["07:00", "13:30"],
			["16:30", "19:30"],
		],
		4: [
			["07:00", "13:30"],
			["16:30", "19:30"],
		],
		5: [
			["07:00", "13:30"],
			["16:30", "19:30"],
		],
		6: [["07:30", "13:00"]],
	},
};

/** Ristoranti, trattorie, pizzerie, osterie: due servizi, lunedì chiuso. */
const RISTORAZIONE: HoursArchetype = {
	id: "ristorazione",
	days: {
		1: [
			["12:00", "14:30"],
			["19:00", "23:00"],
		],
		2: [
			["12:00", "14:30"],
			["19:00", "23:00"],
		],
		3: [
			["12:00", "14:30"],
			["19:00", "23:00"],
		],
		4: [
			["12:00", "14:30"],
			["19:00", "23:30"],
		],
		5: [
			["12:00", "14:30"],
			["19:00", "23:30"],
		],
		6: [
			["12:00", "15:00"],
			["19:00", "22:30"],
		],
	},
};

/** Caffetterie: orario continuato dal mattino presto. */
const CAFFETTERIA: HoursArchetype = {
	id: "caffetteria",
	days: {
		0: [["06:30", "19:30"]],
		1: [["06:30", "19:30"]],
		2: [["06:30", "19:30"]],
		3: [["06:30", "19:30"]],
		4: [["06:30", "20:00"]],
		5: [["07:00", "20:00"]],
		6: [["07:30", "13:00"]],
	},
};

/** Gelaterie: pomeriggio e sera, lunedì chiuso. */
const GELATERIA: HoursArchetype = {
	id: "gelateria",
	days: {
		1: [["11:00", "23:00"]],
		2: [["11:00", "23:00"]],
		3: [["11:00", "23:00"]],
		4: [["11:00", "23:30"]],
		5: [["11:00", "23:30"]],
		6: [["11:00", "23:00"]],
	},
};

/** Negozi di vicinato non alimentari: lunedì mattina chiuso. */
const NEGOZIO: HoursArchetype = {
	id: "negozio",
	days: {
		0: [["15:30", "19:30"]],
		1: [
			["09:30", "13:00"],
			["15:30", "19:30"],
		],
		2: [
			["09:30", "13:00"],
			["15:30", "19:30"],
		],
		3: [
			["09:30", "13:00"],
			["15:30", "19:30"],
		],
		4: [
			["09:30", "13:00"],
			["15:30", "19:30"],
		],
		5: [
			["09:30", "13:00"],
			["15:30", "19:30"],
		],
	},
};

/** Ferramenta: orario da bottega artigiana, sabato solo mattina. */
const FERRAMENTA: HoursArchetype = {
	id: "ferramenta",
	days: {
		0: [
			["08:00", "12:30"],
			["14:30", "18:30"],
		],
		1: [
			["08:00", "12:30"],
			["14:30", "18:30"],
		],
		2: [
			["08:00", "12:30"],
			["14:30", "18:30"],
		],
		3: [
			["08:00", "12:30"],
			["14:30", "18:30"],
		],
		4: [
			["08:00", "12:30"],
			["14:30", "18:30"],
		],
		5: [["08:00", "12:30"]],
	},
};

/** Fioristi e vivai: domenica mattina aperti (è il giorno dei fiori). */
const VERDE: HoursArchetype = {
	id: "verde",
	days: {
		0: [
			["08:30", "13:00"],
			["15:00", "19:00"],
		],
		1: [
			["08:30", "13:00"],
			["15:00", "19:00"],
		],
		2: [
			["08:30", "13:00"],
			["15:00", "19:00"],
		],
		3: [
			["08:30", "13:00"],
			["15:00", "19:00"],
		],
		4: [
			["08:30", "13:00"],
			["15:00", "19:00"],
		],
		5: [
			["08:30", "13:00"],
			["15:00", "19:00"],
		],
		6: [["08:30", "12:30"]],
	},
};

const PREFIX_TO_HOURS: Record<string, HoursArchetype> = {
	Alimentari: BOTTEGA,
	Macelleria: BOTTEGA,
	Gastronomia: BOTTEGA,
	Enoteca: BOTTEGA,
	Panificio: FORNO,
	Pasticceria: FORNO,
	Ristorante: RISTORAZIONE,
	Trattoria: RISTORAZIONE,
	Pizzeria: RISTORAZIONE,
	Osteria: RISTORAZIONE,
	Caffetteria: CAFFETTERIA,
	Gelateria: GELATERIA,
	Boutique: NEGOZIO,
	Gioielleria: NEGOZIO,
	Libreria: NEGOZIO,
	Erboristeria: NEGOZIO,
	Pelletteria: NEGOZIO,
	Sartoria: NEGOZIO,
	Ottica: NEGOZIO,
	Profumeria: NEGOZIO,
	Cartoleria: NEGOZIO,
	Ceramiche: NEGOZIO,
	Ferramenta: FERRAMENTA,
	Fiorista: VERDE,
	Vivaio: VERDE,
};

// ── Categoria negozio ─────────────────────────────────────

/**
 * `businessPrefix` → nome esatto in `store_categories`. Diciassette prefissi
 * combaciano già; gli altri hanno un alias qui sotto. `Ottica` non ha una
 * categoria corrispondente e resta volutamente senza: serve almeno un negozio
 * con `categoryId` nullo per verificare la scheda senza chip di categoria.
 */
const PREFIX_TO_CATEGORY: Record<string, string> = {
	Panificio: "Panetteria",
	Trattoria: "Ristorante",
	Osteria: "Ristorante",
	Boutique: "Abbigliamento donna",
	Sartoria: "Abbigliamento",
	Ceramiche: "Casalinghi",
	Vivaio: "Vivai",
};

function categoryNameFor(prefix: string): string | null {
	if (prefix === "Ottica") return null;
	return PREFIX_TO_CATEGORY[prefix] ?? prefix;
}

// ── Descrizioni ───────────────────────────────────────────

interface ArchetypeCopy {
	/** Paragrafo per il livello `full` (il campo accetta fino a 1000 caratteri). */
	long: readonly string[];
	/** Riga singola, più caratterizzata del pool generico, per il livello `basic`. */
	short: readonly string[];
}

const COPY_BY_ARCHETYPE: Record<string, ArchetypeCopy> = {
	bottega: {
		long: [
			"Facciamo la spesa con voi da trent'anni. Formaggi di malga che andiamo a prendere due volte al mese, salumi tagliati al coltello, conserve che prepariamo noi quando la stagione è giusta.\n\nSe cercate qualcosa che non abbiamo, chiedete: quasi sempre arriva entro due giorni.",
			"Bottega di quartiere: frutta e verdura del contadino tre volte a settimana, pasta fresca tirata la mattina, un banco di formaggi scelti uno per uno. Consigliamo volentieri, anche per le dosi — meglio tornare che buttare.",
		],
		short: [
			"Formaggi di malga, salumi al coltello e conserve di stagione fatte in casa.",
			"Spesa di quartiere: verdura del contadino e pasta fresca ogni mattina.",
		],
	},
	forno: {
		long: [
			"Impastiamo alle quattro del mattino con lievito madre che portiamo avanti dal 1998. Pane di grano tenero, integrale e una pagnotta di segale il giovedì.\n\nLa domenica mattina ci sono i cornetti caldi fino alle undici: dopo, di solito, è finito tutto.",
			"Pasticceria di famiglia, seconda generazione. Lavoriamo burro e uova fresche, niente semilavorati: si sente nella sfoglia e si vede nel tempo che tengono le creme. Torte su ordinazione con due giorni di preavviso.",
		],
		short: [
			"Pane a lievito madre e cornetti caldi la domenica mattina.",
			"Pasticceria di famiglia: burro, uova fresche e niente semilavorati.",
		],
	},
	ristorazione: {
		long: [
			"Cucina di casa, menù corto che cambia con il mercato. Scriviamo i piatti a mano ogni mattina perché dipendono da cosa abbiamo trovato.\n\nQuindici coperti dentro e sei fuori quando il tempo tiene: conviene prenotare, soprattutto il venerdì.",
			"Trattoria aperta nel 1974 dai nonni, stessa sala e quasi le stesse ricette. Pasta tirata in casa, secondi di carne e due piatti di pesce il martedì e il venerdì. La carta dei vini è tutta di produttori entro cento chilometri.",
		],
		short: [
			"Menù corto che cambia con il mercato, scritto a mano ogni mattina.",
			"Trattoria dal 1974: pasta tirata in casa e vini di produttori vicini.",
		],
	},
	caffetteria: {
		long: [
			"Apriamo alle sei e mezza per chi va al lavoro. Miscela tostata da un piccolo torrefattore a quaranta chilometri, macinata al momento; se preferite un monorigine, chiedete quale abbiamo aperto oggi.\n\nA pranzo tramezzini e due primi, niente di più: preferiamo farne pochi e farli bene.",
			"Bar di quartiere dove ci si conosce per nome. Caffè, brioche del forno qui accanto, aperitivo dalle sei con quello che ha preparato la cucina. Tavolini fuori da marzo a ottobre.",
		],
		short: [
			"Caffè macinato al momento, miscela di un torrefattore a quaranta chilometri.",
			"Bar di quartiere: brioche del forno accanto e aperitivo dalle sei.",
		],
	},
	gelateria: {
		long: [
			"Gelato mantecato ogni giorno, venti gusti e non uno di più. Pistacchio di Bronte, nocciola delle Langhe, e la frutta solo quando è la sua stagione: a gennaio non troverete le fragole.\n\nFacciamo anche vaschette da asporto e granite siciliane d'estate.",
			"Laboratorio a vista, latte fresco di una stalla del posto e niente basi pronte. Chi ha intolleranze può chiedere: teniamo sempre quattro gusti senza latte e due senza glutine.",
		],
		short: [
			"Gelato mantecato ogni giorno, frutta solo di stagione.",
			"Laboratorio a vista, latte fresco del posto e niente basi pronte.",
		],
	},
	negozio: {
		long: [
			"Negozio di quartiere dal 1974. Teniamo poche marche ma le conosciamo tutte, e se una cosa non ci convince non la mettiamo sugli scaffali.\n\nOrdiniamo su richiesta anche quello che non abbiamo in assortimento: passate a chiedere, in due giorni arriva.",
			"Assortimento scelto a mano, due volte l'anno, andando a vedere le cose di persona. Consigliamo senza fretta e cambiamo volentieri se a casa il pensiero cambia: capita, non è un problema.",
		],
		short: [
			"Poche marche, scelte a mano. Ordiniamo su richiesta quello che non teniamo.",
			"Assortimento scelto di persona, consigli senza fretta.",
		],
	},
	ferramenta: {
		long: [
			"Ferramenta di paese: viti sciolte al pezzo, duplicazione chiavi, affilatura di lame e forbici. Se portate il pezzo rotto proviamo a capire cos'è prima di vendervene uno nuovo.\n\nAbbiamo ancora i cassetti di legno con le etichette scritte a mano: ci vuole un attimo in più, ma si trova tutto.",
			"Quarant'anni dietro questo banco. Utensili, idraulica, elettrico e la minuteria che nei grandi magazzini non si trova più. Piccole riparazioni in giornata.",
		],
		short: [
			"Viti al pezzo, chiavi duplicate e lame affilate mentre aspettate.",
			"Utensili, idraulica ed elettrico, con la minuteria che non si trova più.",
		],
	},
	verde: {
		long: [
			"Fiori freschi tre volte a settimana dal mercato, piante da interno ed esterno coltivate da noi in serra.\n\nPer matrimoni e cerimonie ci sediamo un attimo insieme: serve capire la stagione prima di promettere una peonia a novembre.",
			"Vivaio di famiglia dal 1986. Aromatiche, da frutto, siepi e un settore di piante grasse che continua a crescere. La domenica mattina siamo aperti: è il giorno in cui si ha tempo di scegliere.",
		],
		short: [
			"Fiori freschi tre volte a settimana e piante coltivate in serra.",
			"Vivaio di famiglia: aromatiche, da frutto, siepi e piante grasse.",
		],
	},
};

// ── Telefoni ──────────────────────────────────────────────

/**
 * Numeri fittizi ma di forma italiana corretta. Il blocco `555` tiene i numeri
 * fuori da qualunque utenza reale, come da convenzione per i dati di prova.
 */
const PHONE_LABELS = [
	"Cellulare",
	"WhatsApp",
	"Laboratorio",
	"Ordini e prenotazioni",
] as const;

function landline(istatCode: string, idx: number): string {
	const handle = ISTAT_TO_SEED_HANDLE[istatCode];
	const prefix = handle ? SEED_MUNICIPALITY_PHONE_PREFIX[handle] : "02";
	return `+39 ${prefix} 555${String(1000 + (idx % 9000))}`;
}

function mobile(idx: number): string {
	const carrier = pick(["335", "347", "320", "389"] as const, idx, 1);
	// Base diversa dal fisso: con la stessa formula i due numeri dello stesso
	// negozio finivano con le identiche quattro cifre.
	return `+39 ${carrier} 555${String(2000 + ((idx * 37) % 7000))}`;
}

// ── Sito web ──────────────────────────────────────────────

/**
 * Dominio sotto `example.com`, riservato alla documentazione (RFC 2606): non
 * risolve mai, quindi nessun link del seed può finire su un sito reale di
 * qualcun altro.
 */
function websiteFor(name: string): string {
	const slug = name
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return `https://www.${slug}.example.com`;
}

// ── Livelli di completezza ────────────────────────────────

type Tier = "full" | "basic" | "bare";

/** Foto totali per livello (copertina inclusa), entro `maxImagesPerStore`. */
const PHOTO_TARGET: Record<Tier, number> = { full: 5, basic: 3, bare: 0 };

/**
 * Livello deterministico da (indice del venditore, posizione del negozio tra i
 * suoi): la stessa ripartizione a ogni `db:reset`, così un negozio "completo"
 * resta completo tra un reseed e l'altro.
 */
function tierFor(sellerIdx: number, rankInSeller: number): Tier {
	const bucket = (sellerIdx * 3 + rankInSeller) % 10;
	if (bucket < 4) return "full";
	if (bucket < 7) return "basic";
	return "bare";
}

function shiftTime(hhmm: string, minutes: number): string {
	const [h, m] = hhmm.split(":").map(Number);
	const total = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + minutes));
	return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Applica uno scostamento alla chiusura serale, così i negozi dello stesso
 * archetipo non chiudono tutti allo stesso minuto. Le fasce del mattino non si
 * toccano: a spostarsi è l'ora di chiusura, non l'apertura.
 */
function scheduleFor(
	archetype: HoursArchetype,
	idx: number,
): Array<{ dayOfWeek: number; slots: Array<{ open: string; close: string }> }> {
	const shift = [0, 30, -30][idx % 3];
	const schedule = Object.entries(archetype.days).map(([dow, ranges]) => ({
		dayOfWeek: Number(dow),
		slots: ranges.map(([open, close], i) => {
			const isEveningClose = i === ranges.length - 1 && close >= "14:00";
			return { open, close: isEveningClose ? shiftTime(close, shift) : close };
		}),
	}));

	// Lo stesso validatore che usa la route del seller: un archetipo incoerente
	// (fasce sovrapposte, chiusura prima dell'apertura) deve far fallire il seed,
	// non finire in pagina.
	const error = validateOpeningHours(schedule);
	if (error) {
		throw new Error(
			`seedStoreProfiles: archetipo '${archetype.id}' non valido — ${error}`,
		);
	}
	return schedule;
}

// ── Seeding ───────────────────────────────────────────────

export async function seedStoreProfiles() {
	const rows = await db
		.select({
			id: store.id,
			name: store.name,
			sellerProfileId: store.sellerProfileId,
			openingHours: store.openingHours,
			categoryId: store.categoryId,
			description: store.description,
			email: user.email,
			istatCode: municipality.istatCode,
		})
		.from(store)
		.innerJoin(sellerProfile, eq(sellerProfile.id, store.sellerProfileId))
		.innerJoin(user, eq(user.id, sellerProfile.userId))
		.innerJoin(municipality, eq(municipality.id, store.municipalityId))
		.where(isNull(store.deletedAt))
		.orderBy(asc(store.sellerProfileId), asc(store.createdAt), asc(store.id));

	if (rows.length === 0) {
		console.log("  ⏭ No stores found, skipping store profiles");
		return;
	}

	// ── Categorie per nome ────────────────────────────────
	const wantedCategories = [
		...new Set(
			businessPrefixes
				.map(categoryNameFor)
				.filter((n): n is string => n !== null),
		),
	];
	const categoryRows = await db
		.select({ id: storeCategory.id, name: storeCategory.name })
		.from(storeCategory)
		.where(inArray(storeCategory.name, wantedCategories));
	const categoryIdByName = new Map(categoryRows.map((c) => [c.name, c.id]));

	const missingCategories = wantedCategories.filter(
		(n) => !categoryIdByName.has(n),
	);
	if (missingCategories.length > 0) {
		throw new Error(
			`seedStoreProfiles: categorie assenti in store_categories: ${missingCategories.join(", ")}. Hai eseguito il seed base?`,
		);
	}

	// ── Stato attuale di telefoni e immagini ──────────────
	const phoneRows = await db
		.selectDistinct({ storeId: storePhoneNumber.storeId })
		.from(storePhoneNumber);
	const withPhones = new Set(phoneRows.map((r) => r.storeId));

	const imageRows = await db
		.select({ storeId: storeImage.storeId, position: storeImage.position })
		.from(storeImage);
	const imageStateByStore = new Map<
		string,
		{ count: number; maxPosition: number }
	>();
	for (const r of imageRows) {
		const cur = imageStateByStore.get(r.storeId) ?? {
			count: 0,
			maxPosition: -1,
		};
		cur.count += 1;
		cur.maxPosition = Math.max(cur.maxPosition, r.position);
		imageStateByStore.set(r.storeId, cur);
	}

	// ── Costruzione ───────────────────────────────────────
	const rankBySeller = new Map<string, number>();
	const newPhones: Array<typeof storePhoneNumber.$inferInsert> = [];
	const newImages: Array<typeof storeImage.$inferInsert> = [];
	const updates: Array<{
		id: string;
		values: Partial<typeof store.$inferInsert>;
	}> = [];
	const counts: Record<Tier, number> = { full: 0, basic: 0, bare: 0 };
	let skipped = 0;

	for (const row of rows) {
		const rank = rankBySeller.get(row.sellerProfileId) ?? 0;
		rankBySeller.set(row.sellerProfileId, rank + 1);

		// Il venditore di sviluppo (seller@dev.bibs) non ha un indice numerico:
		// nessun businessPrefix, quindi niente archetipo né descrizione da pool.
		// Resta comunque un negozio "completo" — è quello dello smoke test.
		const match = row.email.match(/^seller(\d+)@test\.com$/);
		const sellerIdx = match ? Number.parseInt(match[1], 10) - 1 : null;
		const prefix =
			sellerIdx !== null ? pick(businessPrefixes, sellerIdx, 1) : null;
		const tier =
			sellerIdx !== null ? tierFor(sellerIdx, rank) : ("full" as Tier);
		counts[tier] += 1;

		// Già profilato in una corsa precedente: gli orari sono l'ultimo campo a
		// essere scritto per i livelli che li prevedono.
		if (row.openingHours !== null) {
			skipped += 1;
			continue;
		}

		const idx = sellerIdx ?? 0;
		const values: Partial<typeof store.$inferInsert> = {};

		// Categoria: a tutti i livelli. Senza, i filtri per categoria su /stores
		// non trovano nulla.
		if (prefix) {
			const categoryName = categoryNameFor(prefix);
			const categoryId = categoryName
				? (categoryIdByName.get(categoryName) ?? null)
				: null;
			if (categoryId !== row.categoryId) values.categoryId = categoryId;
		}

		if (tier === "bare") {
			// Un negozio appena aperto che non ha ancora compilato nulla. Una fetta
			// resta anche senza descrizione, per vedere la scheda senza quel blocco.
			if ((idx + rank) % 4 === 0 && row.description !== null) {
				values.description = null;
			}
			if (Object.keys(values).length > 0) {
				updates.push({ id: row.id, values });
			} else {
				skipped += 1;
			}
			continue;
		}

		const archetype = prefix ? PREFIX_TO_HOURS[prefix] : NEGOZIO;
		if (!archetype) {
			throw new Error(
				`seedStoreProfiles: nessun archetipo di orari per il prefisso '${prefix}'`,
			);
		}
		values.openingHours = scheduleFor(archetype, idx + rank);

		// Le descrizioni del pool sono legate all'archetipo: una pasticceria non
		// può parlare di viti sciolte. I negozi del dev seller tengono la loro,
		// che è un'etichetta di smoke test.
		if (prefix) {
			const copy = COPY_BY_ARCHETYPE[archetype.id];
			values.description =
				tier === "full"
					? pick(copy.long, idx + rank, 1)
					: pick(copy.short, idx + rank, 1);
		}

		if (tier === "full") {
			values.websiteUrl = websiteFor(row.name);
		}

		// ── Telefoni ────────────────────────────────────────
		if (!withPhones.has(row.id)) {
			newPhones.push({
				storeId: row.id,
				label: tier === "full" ? "Negozio" : null,
				number: landline(row.istatCode, idx + rank),
				position: 0,
			});
			if (tier === "full") {
				newPhones.push({
					storeId: row.id,
					label: pick(PHONE_LABELS, idx + rank, 1),
					number: mobile(idx + rank),
					position: 1,
				});
			}
		}

		// ── Foto di vetrina ─────────────────────────────────
		const state = imageStateByStore.get(row.id) ?? {
			count: 0,
			maxPosition: -1,
		};
		const target = Math.min(PHOTO_TARGET[tier], config.maxImagesPerStore);
		for (let i = state.count; i < target; i++) {
			const position = state.maxPosition + 1 + (i - state.count);
			newImages.push({
				storeId: row.id,
				url: `https://picsum.photos/seed/store-${row.id}-v${position}/1200/900`,
				key: `picsum-store-${row.id}-${position}`,
				position,
			});
		}

		updates.push({ id: row.id, values });
	}

	if (
		updates.length === 0 &&
		newPhones.length === 0 &&
		newImages.length === 0
	) {
		console.log(
			`  ⏭ Store profiles already seeded (${skipped} stores), skipping`,
		);
		return;
	}

	console.log(
		`  🏷 Seeding store profiles for ${updates.length} stores (${counts.full} full, ${counts.basic} basic, ${counts.bare} bare; ${skipped} already done)...`,
	);

	for (const u of updates) {
		await db.update(store).set(u.values).where(eq(store.id, u.id));
	}
	if (newPhones.length > 0) {
		await db.insert(storePhoneNumber).values(newPhones);
	}
	if (newImages.length > 0) {
		await db.insert(storeImage).values(newImages);
	}

	console.log(
		`  ✓ ${updates.length} store profiles seeded (${newPhones.length} phone numbers, ${newImages.length} extra photos)`,
	);
}
