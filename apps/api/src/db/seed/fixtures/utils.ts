import { eq } from "drizzle-orm";
import { db } from "@/db";
import { municipality } from "@/db/schemas/location";

// ── Helpers ───────────────────────────────────────────────

/** Deterministic pick from an array with stride + offset for variety. */
export function pick<T>(
	arr: readonly T[],
	idx: number,
	stride = 1,
	offset = 0,
): T {
	return arr[(idx * stride + offset) % arr.length];
}

// ── Italian first names ───────────────────────────────────

export const firstNames = [
	"Marco",
	"Luca",
	"Giuseppe",
	"Francesco",
	"Alessandro",
	"Andrea",
	"Matteo",
	"Lorenzo",
	"Davide",
	"Simone",
	"Fabio",
	"Paolo",
	"Roberto",
	"Massimo",
	"Stefano",
	"Giovanni",
	"Antonio",
	"Riccardo",
	"Daniele",
	"Nicola",
	"Maria",
	"Anna",
	"Sara",
	"Laura",
	"Giulia",
	"Francesca",
	"Chiara",
	"Valentina",
	"Alessia",
	"Federica",
	"Silvia",
	"Elisa",
	"Martina",
	"Roberta",
	"Monica",
	"Paola",
	"Elena",
	"Simona",
	"Angela",
	"Cristina",
];

// ── Italian last names ────────────────────────────────────

export const lastNames = [
	"Rossi",
	"Russo",
	"Ferrari",
	"Esposito",
	"Bianchi",
	"Romano",
	"Colombo",
	"Ricci",
	"Marino",
	"Greco",
	"Bruno",
	"Gallo",
	"Conti",
	"De Luca",
	"Mancini",
	"Costa",
	"Giordano",
	"Rizzo",
	"Lombardi",
	"Moretti",
	"Barbieri",
	"Fontana",
	"Santoro",
	"Mariani",
	"Rinaldi",
	"Caruso",
	"Ferrara",
	"Galli",
	"Martini",
	"Leone",
	"Longo",
	"Gentile",
	"Martinelli",
	"Vitale",
	"Villa",
	"Marchetti",
	"Serra",
	"Bianco",
	"Sala",
	"Barone",
	"Pellegrini",
	"De Santis",
	"Monti",
	"Fabbri",
	"Grasso",
];

// ── ISTAT municipality helpers ────────────────────────────

/**
 * Restituisce l'`id` del comune corrispondente a un codice ISTAT a 6 cifre.
 */
export async function getMunicipalityIdByIstat(
	istatCode: string,
): Promise<string> {
	const row = await db.query.municipality.findFirst({
		where: eq(municipality.istatCode, istatCode),
		columns: { id: true },
	});
	if (!row) {
		throw new Error(
			`Seed: nessun comune con codice ISTAT ${istatCode}. Hai eseguito il seed base?`,
		);
	}
	return row.id;
}

/**
 * Set deterministico di comuni "vetrina" usati dai seed di sviluppo.
 * ISTAT code → handle mnemonic.
 */
export const SEED_MUNICIPALITIES = {
	milano: "015146",
	roma: "058091",
	torino: "001272",
	bologna: "037006",
	firenze: "048017",
	napoli: "063049",
	bari: "072006",
	palermo: "082053",
	genova: "010025",
	venezia: "027042",
} as const;

export type SeedMunicipalityHandle = keyof typeof SEED_MUNICIPALITIES;

export async function getSeedMunicipalityIds(): Promise<
	Record<SeedMunicipalityHandle, string>
> {
	const entries = await Promise.all(
		(
			Object.entries(SEED_MUNICIPALITIES) as Array<
				[SeedMunicipalityHandle, string]
			>
		).map(
			async ([key, istat]) =>
				[key, await getMunicipalityIdByIstat(istat)] as const,
		),
	);
	return Object.fromEntries(entries) as Record<SeedMunicipalityHandle, string>;
}

/**
 * Coordinate approssimative per comune seed, usate per popolare `location` nei negozi.
 */
export const SEED_MUNICIPALITY_COORDS: Record<
	SeedMunicipalityHandle,
	{ lat: number; lng: number; zip: string }
> = {
	milano: { lat: 45.4642, lng: 9.19, zip: "20121" },
	roma: { lat: 41.9028, lng: 12.4964, zip: "00185" },
	torino: { lat: 45.0703, lng: 7.6869, zip: "10121" },
	bologna: { lat: 44.4949, lng: 11.3426, zip: "40121" },
	firenze: { lat: 43.7696, lng: 11.2558, zip: "50121" },
	napoli: { lat: 40.8518, lng: 14.2681, zip: "80121" },
	bari: { lat: 41.1171, lng: 16.8719, zip: "70121" },
	palermo: { lat: 38.1157, lng: 13.3615, zip: "90121" },
	genova: { lat: 44.4056, lng: 8.9463, zip: "16121" },
	venezia: { lat: 45.4408, lng: 12.3155, zip: "30121" },
};

// ── Brand pool ────────────────────────────────────────────

export const brandPool = [
	"Barilla",
	"Lavazza",
	"Ferrari",
	"Armani",
	"Luxottica",
	"Pirelli",
	"Campari",
	"Illy",
	"Ferrero",
	"Loro Piana",
	"Diesel",
	"Geox",
	"Calzedonia",
	"Slow Food",
	"Eataly",
	"Esselunga",
	"Mutti",
	"San Pellegrino",
	"Aperol",
	"Galbani",
] as const;

// ── businessPrefix → product macro-category (CSV exact names) ─

/**
 * Maps each `businessPrefix` from `sellers.ts` to the macro-category it sells.
 * Macro names must match exactly the values loaded by `seedProductCategories()`
 * from `product_categories.csv`.
 */
export const prefixToMacro: Record<string, string> = {
	Alimentari: "Alimentari e bevande",
	Panificio: "Alimentari e bevande",
	Pasticceria: "Alimentari e bevande",
	Macelleria: "Alimentari e bevande",
	Enoteca: "Alimentari e bevande",
	Gastronomia: "Alimentari e bevande",
	Caffetteria: "Alimentari e bevande",
	Gelateria: "Alimentari e bevande",
	Ristorante: "Alimentari e bevande",
	Trattoria: "Alimentari e bevande",
	Pizzeria: "Alimentari e bevande",
	Osteria: "Alimentari e bevande",
	Boutique: "Abbigliamento",
	Pelletteria: "Abbigliamento",
	Sartoria: "Abbigliamento",
	Gioielleria: "Abbigliamento",
	Ottica: "Abbigliamento",
	Ferramenta: "Fai da te e industria",
	Ceramiche: "Casa e cucina",
	Profumeria: "Bellezza e cura personale",
	Erboristeria: "Bellezza e cura personale",
	Libreria: "Libri e media",
	Cartoleria: "Ufficio e scuola",
	Fiorista: "Giardino e outdoor",
	Vivaio: "Giardino e outdoor",
};

// ── Product noun pools per macro ──────────────────────────

export const productNouns: Record<string, readonly string[]> = {
	"Alimentari e bevande": [
		"Pasta di grano duro",
		"Olio extravergine",
		"Caffè in grani",
		"Riso Carnaroli",
		"Pomodori pelati",
		"Vino rosso",
		"Biscotti",
		"Miele millefiori",
		"Formaggio stagionato",
		"Cioccolato fondente",
		"Tisana",
		"Spaghetti",
	],
	Abbigliamento: [
		"Camicia",
		"Sciarpa in lana",
		"Borsa in pelle",
		"Cintura",
		"Cappello",
		"Occhiali da sole",
		"Cravatta",
		"Foulard",
		"Guanti",
		"Portafoglio",
	],
	"Casa e cucina": [
		"Tazza in ceramica",
		"Set di piatti",
		"Vassoio decorato",
		"Vaso",
		"Lampada da tavolo",
		"Tovaglia",
		"Centro tavola",
		"Posate in acciaio",
	],
	"Fai da te e industria": [
		"Trapano",
		"Cacciavite",
		"Set chiavi",
		"Pinza",
		"Sega manuale",
		"Martello",
		"Vernice",
		"Pennello",
	],
	"Bellezza e cura personale": [
		"Crema viso",
		"Olio essenziale",
		"Sapone naturale",
		"Balsamo capelli",
		"Profumo",
		"Tisana erboristica",
		"Maschera viso",
		"Shampoo bio",
	],
	"Libri e media": [
		"Romanzo",
		"Saggio",
		"Manuale di cucina",
		"Libro illustrato",
		"Biografia",
		"Poesie",
		"Guida turistica",
	],
	"Ufficio e scuola": [
		"Quaderno",
		"Penna stilografica",
		"Agenda",
		"Set di matite",
		"Astuccio",
		"Risma di carta",
		"Cartelletta",
	],
	"Giardino e outdoor": [
		"Bouquet di fiori",
		"Pianta da interno",
		"Vaso in terracotta",
		"Pacchetto semi",
		"Bonsai",
		"Composizione floreale",
	],
};

export const productAdjectives = [
	"artigianale",
	"premium",
	"classico",
	"italiano",
	"biologico",
	"delicato",
	"moderno",
	"selezionato",
	"esclusivo",
	"naturale",
] as const;

export const productDescriptions = [
	"Prodotto selezionato dai nostri artigiani con materie prime di alta qualità.",
	"Realizzato secondo la tradizione italiana, perfetto per ogni occasione.",
	"Un classico intramontabile, scelto da generazioni di clienti soddisfatti.",
	"Cura dei dettagli e qualità superiore in ogni singolo pezzo.",
	"Dal nostro territorio direttamente al tuo carrello: filiera corta garantita.",
	"Lavorazione artigianale che preserva l'autenticità dei sapori e dei profumi.",
	"Ideale per chi cerca il meglio senza compromessi sulla qualità.",
	"Selezionato con cura per offrire un'esperienza unica ai nostri clienti.",
	"Prodotto di alta gamma realizzato con tecniche tradizionali.",
	"Risultato di anni di esperienza e passione per l'eccellenza.",
	"Materie prime di prima scelta per un risultato finale impeccabile.",
	"Confezione studiata per preservare la freschezza e la qualità nel tempo.",
];

/**
 * Generates a deterministic 13-digit EAN starting from 8000000000000.
 * Satisfies `product_ean_format` regex `^(\d{8}|\d{13})$`.
 */
export function genEan13(globalIdx: number): string {
	return (8000000000000n + BigInt(globalIdx)).toString();
}

// ── Italian street names ──────────────────────────────────

export const streets = [
	"Via Roma",
	"Via Garibaldi",
	"Via Dante",
	"Corso Italia",
	"Via Mazzini",
	"Via Verdi",
	"Via XX Settembre",
	"Via Cavour",
	"Via Marconi",
	"Via Matteotti",
	"Corso Vittorio Emanuele",
	"Via Nazionale",
	"Via della Libertà",
	"Via Don Minzoni",
	"Via Galilei",
	"Via Leonardo da Vinci",
	"Via Colombo",
	"Via Carducci",
	"Via San Marco",
	"Via Leopardi",
	"Via Pascoli",
	"Via Manzoni",
	"Via Petrarca",
	"Via della Stazione",
	"Corso Buenos Aires",
	"Via del Corso",
	"Via Gramsci",
	"Via Torino",
	"Piazza della Repubblica",
	"Piazza del Popolo",
];
