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
 * Prefisso telefonico urbano per comune seed. Serve ai numeri di telefono dei
 * negozi: un fisso genovese comincia per 010, uno milanese per 02.
 */
export const SEED_MUNICIPALITY_PHONE_PREFIX: Record<
	SeedMunicipalityHandle,
	string
> = {
	milano: "02",
	roma: "06",
	torino: "011",
	bologna: "051",
	firenze: "055",
	napoli: "081",
	bari: "080",
	palermo: "091",
	genova: "010",
	venezia: "041",
};

/** ISTAT → handle, per risalire al comune partendo da una riga di `stores`. */
export const ISTAT_TO_SEED_HANDLE: Record<string, SeedMunicipalityHandle> =
	Object.fromEntries(
		(
			Object.entries(SEED_MUNICIPALITIES) as Array<
				[SeedMunicipalityHandle, string]
			>
		).map(([handle, istat]) => [istat, handle]),
	) as Record<string, SeedMunicipalityHandle>;

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
	// Blocco bolognese (`bolognaPrefixes`).
	Pescheria: "Alimentari e bevande",
	Bar: "Alimentari e bevande",
	Parrucchiere: "Bellezza e cura personale",
	Barbiere: "Bellezza e cura personale",
	Parafarmacia: "Bellezza e cura personale",
	Fumetteria: "Libri e media",
	Biciclette: "Sport e tempo libero",
	"Articoli sportivi": "Sport e tempo libero",
	Giocattoli: "Infanzia",
	Elettronica: "Elettronica",
	Telefonia: "Elettronica",
	Copisteria: "Ufficio e scuola",
	"Pet shop": "Animali domestici",
	Merceria: "Hobby e creatività",
	Casalinghi: "Casa e cucina",
	"Ricambi auto": "Auto e moto",
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
	"Sport e tempo libero": [
		"Scarpe da running",
		"Camera d'aria",
		"Casco da bici",
		"Borraccia termica",
		"Tappetino yoga",
		"Pallone da calcio",
		"Guanti da ciclismo",
		"Zaino da trekking",
		"Corda per saltare",
		"Racchetta da tennis",
	],
	Infanzia: [
		"Puzzle in legno",
		"Set di costruzioni",
		"Peluche",
		"Gioco da tavolo",
		"Trenino",
		"Bambola",
		"Libro tattile",
		"Macchinina",
		"Pista biglie",
		"Cubo sensoriale",
	],
	Elettronica: [
		"Cuffie wireless",
		"Cavo USB-C",
		"Powerbank",
		"Caricatore rapido",
		"Mouse ottico",
		"Tastiera meccanica",
		"Altoparlante bluetooth",
		"Pellicola protettiva",
		"Hub multiporta",
		"Adattatore HDMI",
	],
	"Animali domestici": [
		"Crocchette per cani",
		"Cuccia in tessuto",
		"Guinzaglio",
		"Tiragraffi",
		"Lettiera vegetale",
		"Gioco per gatti",
		"Ciotola in acciaio",
		"Spazzola per pelo",
		"Trasportino",
		"Mangime per uccelli",
	],
	"Hobby e creatività": [
		"Gomitolo di lana",
		"Set di aghi",
		"Nastro di raso",
		"Bottoni assortiti",
		"Telaio da ricamo",
		"Filato di cotone",
		"Forbici da sarta",
		"Cerniera lampo",
		"Kit maglia",
		"Metro da sarta",
	],
	"Auto e moto": [
		"Filtro dell'aria",
		"Spazzole tergicristallo",
		"Olio motore",
		"Pastiglie freno",
		"Lampadina alogena",
		"Batteria per auto",
		"Tappetini in gomma",
		"Catena di distribuzione",
		"Liquido refrigerante",
		"Kit di riparazione",
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

// ── Area bolognese ────────────────────────────────────────

/**
 * Comuni della prima cintura bolognese: tutti entro ~15 km da Piazza Maggiore
 * (quindi dentro i preset del filtro distanza) e tutti sul prefisso 051.
 *
 * Stanno fuori da `SEED_MUNICIPALITIES` di proposito: quel pool è indicizzato
 * per posizione da `pickHandle()`, e allungarlo sposterebbe il comune di ogni
 * negozio già seedato.
 */
export const BOLOGNA_BELT = {
	anzola: "037001",
	calderara: "037009",
	casalecchio: "037011",
	castelMaggiore: "037019",
	castenaso: "037021",
	granarolo: "037030",
	ozzano: "037046",
	pianoro: "037047",
	sanLazzaro: "037054",
	sassoMarconi: "037057",
	zolaPredosa: "037060",
} as const;

export type BolognaBeltHandle = keyof typeof BOLOGNA_BELT;
export type AnyMunicipalityHandle = SeedMunicipalityHandle | BolognaBeltHandle;

interface Place {
	/** Nome leggibile, usato per comporre le insegne ("Bar Casalecchio"). */
	name: string;
	lat: number;
	lng: number;
	zip: string;
}

export const BOLOGNA_BELT_PLACES: Record<BolognaBeltHandle, Place> = {
	anzola: { name: "Anzola", lat: 44.5464, lng: 11.195, zip: "40011" },
	calderara: { name: "Calderara", lat: 44.5497, lng: 11.2705, zip: "40012" },
	casalecchio: {
		name: "Casalecchio",
		lat: 44.4767,
		lng: 11.2761,
		zip: "40033",
	},
	castelMaggiore: {
		name: "Castel Maggiore",
		lat: 44.5776,
		lng: 11.3606,
		zip: "40013",
	},
	castenaso: { name: "Castenaso", lat: 44.5074, lng: 11.4718, zip: "40055" },
	granarolo: { name: "Granarolo", lat: 44.5537, lng: 11.4442, zip: "40057" },
	ozzano: { name: "Ozzano", lat: 44.4457, lng: 11.479, zip: "40064" },
	pianoro: { name: "Pianoro", lat: 44.3907, lng: 11.3417, zip: "40065" },
	sanLazzaro: { name: "San Lazzaro", lat: 44.4706, lng: 11.4083, zip: "40068" },
	sassoMarconi: {
		name: "Sasso Marconi",
		lat: 44.3993,
		lng: 11.2508,
		zip: "40037",
	},
	zolaPredosa: { name: "Zola Predosa", lat: 44.488, lng: 11.219, zip: "40069" },
};

/**
 * Ancore dentro il comune di Bologna, una per zona, con il CAP che le compete.
 * Servono a non impilare tutti i negozi su Piazza Maggiore: con un solo centro
 * la vista mappa mostra un cluster unico e il filtro distanza non discrimina.
 */
export const BOLOGNA_DISTRICTS: readonly Place[] = [
	{ name: "Centro", lat: 44.4938, lng: 11.3426, zip: "40124" },
	{ name: "Porto", lat: 44.4993, lng: 11.3286, zip: "40122" },
	{ name: "Saragozza", lat: 44.487, lng: 11.3268, zip: "40135" },
	{ name: "Bolognina", lat: 44.5122, lng: 11.345, zip: "40128" },
	{ name: "Corticella", lat: 44.5384, lng: 11.3521, zip: "40129" },
	{ name: "San Donato", lat: 44.5081, lng: 11.372, zip: "40127" },
	{ name: "Massarenti", lat: 44.4954, lng: 11.3796, zip: "40138" },
	{ name: "Mazzini", lat: 44.4816, lng: 11.3722, zip: "40139" },
	{ name: "Murri", lat: 44.4808, lng: 11.356, zip: "40137" },
	{ name: "Colli", lat: 44.477, lng: 11.3384, zip: "40136" },
	{ name: "Barca", lat: 44.49, lng: 11.2967, zip: "40133" },
	{ name: "Borgo Panigale", lat: 44.5104, lng: 11.279, zip: "40132" },
	{ name: "San Ruffillo", lat: 44.465, lng: 11.362, zip: "40141" },
	{ name: "Lame", lat: 44.519, lng: 11.316, zip: "40131" },
];

const beltHandles = Object.keys(BOLOGNA_BELT) as BolognaBeltHandle[];

/** Comuni "vetrina" nazionali + cintura bolognese, risolti in un colpo solo. */
export async function getAllMunicipalityIds(): Promise<
	Record<AnyMunicipalityHandle, string>
> {
	const all = {
		...SEED_MUNICIPALITIES,
		...BOLOGNA_BELT,
	} as Record<AnyMunicipalityHandle, string>;
	const entries = await Promise.all(
		(Object.entries(all) as Array<[AnyMunicipalityHandle, string]>).map(
			async ([key, istat]) =>
				[key, await getMunicipalityIdByIstat(istat)] as const,
		),
	);
	return Object.fromEntries(entries) as Record<AnyMunicipalityHandle, string>;
}

/**
 * ISTAT → prefisso telefonico urbano. Copre entrambi i pool: senza la cintura,
 * i negozi di Casalecchio o Pianoro finirebbero sul fallback milanese.
 */
export const PHONE_PREFIX_BY_ISTAT: Record<string, string> = {
	...Object.fromEntries(
		(
			Object.entries(SEED_MUNICIPALITIES) as Array<
				[SeedMunicipalityHandle, string]
			>
		).map(([handle, istat]) => [istat, SEED_MUNICIPALITY_PHONE_PREFIX[handle]]),
	),
	...Object.fromEntries(
		Object.values(BOLOGNA_BELT).map((istat) => [istat, "051"]),
	),
};

/**
 * Scostamento deterministico in gradi, dentro ±`spanDeg`. Serve a spargere i
 * negozi attorno a un'ancora: `(idx % 10) * 0.001` produceva collisioni esatte
 * ogni dieci venditori, cioè pin sovrapposti sulla mappa.
 */
export function jitter(idx: number, salt: number, spanDeg: number): number {
	const h = Math.sin(idx * 12.9898 + salt * 78.233) * 43758.5453;
	return (h - Math.floor(h) - 0.5) * 2 * spanDeg;
}

/** Dove sta un negozio: comune, CAP, coordinate e nome della zona. */
export interface StorePlacement {
	municipalityHandle: AnyMunicipalityHandle;
	zipCode: string;
	lat: number;
	lng: number;
	/** Quartiere o comune, per comporre l'insegna. */
	place: string;
}

function around(anchor: Place, idx: number, salt: number, span: number) {
	return {
		zipCode: anchor.zip,
		lat: anchor.lat + jitter(idx, salt, span),
		lng: anchor.lng + jitter(idx, salt + 1, span),
		place: anchor.name,
	};
}

/**
 * Collocazione nell'area bolognese: tre negozi su cinque in città (sparsi sulle
 * zone), gli altri due nella cintura. `variant` distingue i punti vendita
 * successivi della stessa insegna, che così non si sovrappongono.
 *
 * I passi (5 sui quattordici quartieri, 3 sugli undici comuni) sono coprimi con
 * la lunghezza del rispettivo elenco: con un passo che condivide un fattore —
 * 7 su 14, per dire — l'indice ricade sempre sulle stesse due voci.
 */
export function bolognaAreaPlacement(idx: number, variant = 0): StorePlacement {
	const inCity = (idx * 2 + variant) % 5 < 3;
	if (inCity) {
		const anchor =
			BOLOGNA_DISTRICTS[(idx * 5 + variant * 3) % BOLOGNA_DISTRICTS.length];
		return {
			municipalityHandle: "bologna",
			...around(anchor, idx, variant * 17 + 1, 0.004),
		};
	}
	const handle = beltHandles[(idx * 3 + variant * 4) % beltHandles.length];
	return {
		municipalityHandle: handle,
		...around(BOLOGNA_BELT_PLACES[handle], idx, variant * 17 + 5, 0.003),
	};
}

/**
 * Collocazione nei comuni vetrina nazionali. Bologna usa le stesse ancore di
 * quartiere dell'area bolognese, così i negozi storici non restano impilati
 * in centro mentre i nuovi sono sparsi.
 */
export function nationalPlacement(
	handle: SeedMunicipalityHandle,
	idx: number,
	variant = 0,
): StorePlacement {
	if (handle === "bologna") {
		const anchor =
			BOLOGNA_DISTRICTS[(idx * 3 + variant * 5) % BOLOGNA_DISTRICTS.length];
		return {
			municipalityHandle: "bologna",
			...around(anchor, idx, variant * 17 + 3, 0.004),
		};
	}
	const coords = SEED_MUNICIPALITY_COORDS[handle];
	return {
		municipalityHandle: handle,
		...around({ name: handle, ...coords }, idx, variant * 17 + 7, 0.02),
	};
}

// ── Tipi di negozio ───────────────────────────────────────

/**
 * Tipi di attività dei venditori "nazionali" (idx 0..54). L'ordine è
 * significativo: `prefixForSeller()` indicizza per posizione, quindi inserire
 * o togliere una voce cambierebbe categoria, orari e catalogo di ogni
 * venditore già seedato.
 */
export const businessPrefixes = [
	"Alimentari",
	"Panificio",
	"Pasticceria",
	"Macelleria",
	"Enoteca",
	"Ristorante",
	"Trattoria",
	"Boutique",
	"Gioielleria",
	"Libreria",
	"Erboristeria",
	"Fiorista",
	"Ferramenta",
	"Ceramiche",
	"Pelletteria",
	"Gelateria",
	"Pizzeria",
	"Osteria",
	"Caffetteria",
	"Sartoria",
	"Ottica",
	"Profumeria",
	"Cartoleria",
	"Vivaio",
	"Gastronomia",
];

/**
 * Tipi di attività del blocco bolognese (idx ≥ `BOLOGNA_BLOCK_START`). Pool
 * separato per due motivi: allungare `businessPrefixes` rimescolerebbe i
 * venditori esistenti, e questi sedici sbloccano le sei macro merceologiche
 * (animali, auto, elettronica, hobby, infanzia, sport) che finora non avevano
 * un solo prodotto a catalogo.
 *
 * Ogni nome combacia alla lettera con una riga di `store_categories.csv`.
 */
export const bolognaPrefixes = [
	"Pescheria",
	"Bar",
	"Parrucchiere",
	"Barbiere",
	"Fumetteria",
	"Biciclette",
	"Articoli sportivi",
	"Giocattoli",
	"Elettronica",
	"Telefonia",
	"Copisteria",
	"Pet shop",
	"Parafarmacia",
	"Merceria",
	"Casalinghi",
	"Ricambi auto",
];

/** Primo indice del blocco bolognese fra i venditori attivi. */
export const BOLOGNA_BLOCK_START = 55;

/** Tipo di attività di un venditore, dal pool che gli compete. */
export function prefixForSeller(idx: number): string {
	if (idx < BOLOGNA_BLOCK_START) return pick(businessPrefixes, idx, 1);
	return pick(bolognaPrefixes, idx - BOLOGNA_BLOCK_START, 1);
}

/**
 * Parola d'insegna per il tipo di attività: "Articoli sportivi Rossi" non è un
 * nome di negozio, "Sport Rossi" sì. Chi non compare qui usa il proprio nome.
 */
const INSEGNA_OVERRIDES: Record<string, string> = {
	"Articoli sportivi": "Sport",
	Barbiere: "Barberia",
	Biciclette: "Ciclofficina",
	Parrucchiere: "Parrucchieri",
	"Pet shop": "Pet Shop",
	"Ricambi auto": "Ricambi",
};

export function insegnaFor(prefix: string): string {
	return INSEGNA_OVERRIDES[prefix] ?? prefix;
}

/** Insegne del blocco bolognese: tre volte su quattro col cognome, una con la zona. */
export function makeBolognaStoreName(
	prefix: string,
	lastName: string,
	place: string,
	idx: number,
): string {
	const insegna = insegnaFor(prefix);
	const patterns = [
		`${insegna} ${lastName}`,
		`${insegna} ${place}`,
		`${insegna} di ${lastName}`,
		`${insegna} ${lastName}`,
	];
	return patterns[idx % patterns.length];
}
