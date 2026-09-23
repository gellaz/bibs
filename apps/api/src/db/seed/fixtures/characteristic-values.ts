import { and, asc, count, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import { product } from "@/db/schemas/product";
import {
	type CharacteristicDataType,
	productCategoryCharacteristic,
	productCharacteristic,
	productCharacteristicOption,
	productCharacteristicValue,
} from "@/db/schemas/product-characteristic";

/**
 * Valori delle caratteristiche su una fetta dei prodotti seminati.
 *
 * Copertura ~40% dei prodotti attivi con `product_category_id`, scelti con un
 * passo moltiplicativo coprimo rispetto alla lunghezza della lista: la
 * sequenza `(i * stride) % N` con `gcd(stride, N) === 1` è una permutazione
 * di `0..N-1`, quindi i primi `round(N * 0.4)` passi coprono il 40% esatto
 * dei prodotti, distribuiti su tutto l'intervallo — non i primi N*0.4 in
 * ordine, e senza il rischio del passo che condivide un fattore con N (che
 * ricadrebbe sempre sulle stesse posizioni, es. `(idx*7)%14` con soli 2
 * valori distinti).
 *
 * Per ogni prodotto scelto, si valorizzano `n` caratteristiche della sua
 * sotto-categoria (ordinate per `sortOrder`), con `n` fra 3 e il totale,
 * scelto con lo stesso schema a passo coprimo (stavolta rispetto a
 * `totale - 2`, la dimensione dell'intervallo `[3, totale]`).
 *
 * Le `n` caratteristiche NON sono le prime `n` della lista: sarebbe un
 * prefisso fisso, e nel CSV del Task 2 le caratteristiche booleane tendono a
 * comparire in coda a ogni sotto-categoria, quindi un prefisso le
 * raggiungerebbe quasi mai. Si campionano invece con un altro passo coprimo
 * — stavolta rispetto alla lunghezza dell'intera lista — a partire da un
 * offset che varia per prodotto (hash di prodotto + categoria), così
 * l'esposizione si spalma su tutta la lista e varia da prodotto a prodotto.
 */

const CHUNK = 500;

function chunked<T>(arr: T[], size = CHUNK): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) {
		out.push(arr.slice(i, i + size));
	}
	return out;
}

// ── Passo coprimo ──────────────────────────────────────────

function gcd(a: number, b: number): number {
	while (b) {
		[a, b] = [b, a % b];
	}
	return a;
}

/**
 * Il più piccolo passo ≥ `preferred` (ciclico) coprimo con `modulus`. Con
 * `modulus <= 1` qualunque passo va bene (non c'è collasso possibile).
 */
function coprimeStride(preferred: number, modulus: number): number {
	if (modulus <= 1) return 1;
	let s = ((preferred % modulus) + modulus) % modulus || 1;
	while (gcd(s, modulus) !== 1) {
		s = (s % modulus) + 1;
	}
	return s;
}

// ── Hash deterministico per la scelta del valore ──────────
// FNV-1a: solo per variare enum/boolean/number/text fra prodotto e
// caratteristica, non per le selezioni sopra (quelle usano il passo coprimo).

function hashSeed(a: string, b: string): number {
	let h = 0x811c9dc5;
	const s = `${a}:${b}`;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

// ── Intervalli plausibili per i tipi "number" ─────────────

interface NumRange {
	min: number;
	max: number;
	/** Cifre decimali del valore generato (default 0). */
	decimals?: number;
}

function randomInRange(range: NumRange, seed: number): number {
	const decimals = range.decimals ?? 0;
	const scale = 10 ** decimals;
	const minScaled = Math.round(range.min * scale);
	const maxScaled = Math.round(range.max * scale);
	const span = maxScaled - minScaled + 1;
	const value = minScaled + (seed % span);
	return value / scale;
}

// Nota: le tabelle sotto usano come chiave solo il NOME della
// sotto-categoria, non la coppia (macro, sotto-categoria). Due nomi si
// ripetono sotto macro diverse nella matrice — "Stampanti" (Elettronica,
// Ufficio e scuola) e "Pennelli" (Fai da te e industria, Hobby e
// creatività) — e oggi nessuno dei due compare in queste tabelle, quindi
// non c'è ambiguità. Se in futuro si aggiunge una voce per uno dei due nomi,
// si applicherebbe a ENTRAMBE le macro anche se le dimensioni reali
// differissero: a quel punto la chiave deve diventare (macroName, subName),
// non solo subName.

/** Sotto-categorie di mobili/elettrodomestici pesanti: decine di migliaia di grammi. */
const WEIGHT_HEAVY = [
	"Mobili",
	"Scrivanie",
	"Forni",
	"Frigorifer",
	"Materiali edilizia",
	"Arredo giardino",
	"Barbecue",
	"Tapis roulant",
	"Culle",
	"Lettini",
	"Sedie ufficio",
];
/** Bici, valigie, TV, elettrodomestici da banco: qualche chilo. */
const WEIGHT_MEDIUM_HEAVY = [
	"Biciclette",
	"Passeggini",
	"Valigie",
	"Trasportini",
	"Cucce",
	"Batterie auto",
	"Pneumatici",
	"TV",
	"Smart TV",
	"Monitor",
	"Stampanti",
	"Console",
	"Proiettori",
	"Scanner",
	"Seggiolini auto",
	"Accessori bici",
];
/** Gioielleria, piccola elettronica indossabile: pochi grammi. */
const WEIGHT_LIGHT = [
	"Gioielli",
	"Orologi",
	"Occhiali da sole",
	"Cinture",
	"Make-up",
	"Matite",
	"Penne",
	"Auricolari",
	"Cuffie",
	"Mouse",
	"Power bank",
	"Smartwatch",
	"Fitness tracker",
	"Caricabatterie",
	"Custodie smartphone",
];
/** Alimentari confezionati: peso netto della confezione. */
const WEIGHT_FOOD = [
	"Pasta",
	"Riso",
	"Caffè",
	"Tè",
	"Snack",
	"Dolci",
	"Conserve",
	"Succhi",
	"Bevande analcoliche",
	"Prodotti bio",
	"Senza glutine",
];

function classify(
	subName: string,
	buckets: Array<[string[], NumRange]>,
	fallback: NumRange,
): NumRange {
	for (const [prefixes, range] of buckets) {
		if (prefixes.some((p) => subName.startsWith(p))) return range;
	}
	return fallback;
}

/** "Peso" (g): stessa caratteristica, ordini di grandezza diversissimi. */
function weightRangeG(subName: string): NumRange {
	return classify(
		subName,
		[
			[WEIGHT_HEAVY, { min: 8000, max: 60000 }],
			[WEIGHT_MEDIUM_HEAVY, { min: 1200, max: 20000 }],
			[WEIGHT_LIGHT, { min: 10, max: 400 }],
			[WEIGHT_FOOD, { min: 100, max: 1000 }],
		],
		{ min: 50, max: 3000 },
	);
}

/** "Larghezza"/"Altezza"/"Profondità" (cm): solo Casa e cucina + Scrivanie. */
const DIM_RANGES_CM: Record<string, NumRange> = {
	"Biancheria letto": { min: 130, max: 260 },
	Candele: { min: 5, max: 20 },
	"Decorazioni casa": { min: 8, max: 50 },
	Forni: { min: 45, max: 90 },
	"Mobili camera": { min: 40, max: 220 },
	"Mobili cucina": { min: 40, max: 240 },
	"Mobili soggiorno": { min: 40, max: 250 },
	Padelle: { min: 16, max: 34 },
	Pentole: { min: 14, max: 40 },
	"Piccoli elettrodomestici": { min: 10, max: 50 },
	Quadri: { min: 15, max: 100 },
	"Robot cucina": { min: 18, max: 42 },
	Tappeti: { min: 60, max: 300 },
	Tende: { min: 100, max: 300 },
	Scrivanie: { min: 50, max: 160 },
};
function dimRangeCm(subName: string): NumRange {
	return DIM_RANGES_CM[subName] ?? { min: 10, max: 100 };
}

/** "Potenza" (W): lampadine, elettrodomestici da cucina, barbecue, elettronica. */
function powerRangeW(subName: string): NumRange {
	if (subName === "Illuminazione" || subName === "Lampade")
		return { min: 3, max: 100 };
	if (subName === "Utensili cucina") return { min: 300, max: 2000 };
	if (subName === "Barbecue") return { min: 1500, max: 3000 };
	return { min: 2, max: 250 };
}

/** "Dimensione display" (pollici): dal quadrante di uno smartwatch alla TV. */
function displaySizeRange(subName: string): NumRange {
	if (
		[
			"Orologi",
			"Smartwatch",
			"Fitness tracker",
			"Custodie smartphone",
		].includes(subName)
	)
		return { min: 1, max: 2, decimals: 1 };
	if (subName === "Smartphone") return { min: 5.5, max: 7, decimals: 1 };
	if (subName === "eReader") return { min: 6, max: 10, decimals: 1 };
	if (subName === "Tablet") return { min: 7, max: 13, decimals: 1 };
	if (subName === "Laptop" || subName === "Notebook gaming")
		return { min: 13, max: 17, decimals: 1 };
	if (subName === "Monitor") return { min: 21, max: 34, decimals: 1 };
	return { min: 5, max: 15, decimals: 1 };
}

/** "Capacità batteria" (mAh). */
function batteryCapacityRange(subName: string): NumRange {
	if (subName === "Custodie smartphone") return { min: 1000, max: 5000 };
	if (subName === "Smartphone") return { min: 3000, max: 6000 };
	if (subName === "Power bank") return { min: 5000, max: 30000 };
	return { min: 1000, max: 5000 };
}

/** "Autonomia" (h). */
function batteryLifeRange(subName: string): NumRange {
	if (subName === "Orologi") return { min: 24, max: 240 };
	if (subName === "Smartwatch") return { min: 18, max: 72 };
	if (subName === "Fitness tracker") return { min: 24, max: 200 };
	if (subName === "Auricolari" || subName === "Cuffie")
		return { min: 4, max: 40 };
	return { min: 4, max: 48 };
}

/** "Numero porte". */
function portsCountRange(subName: string): NumRange {
	if (subName === "Frigoriferi") return { min: 1, max: 4 };
	if (subName === "Caricabatterie") return { min: 1, max: 6 };
	return { min: 1, max: 4 };
}

// Il resto dei "number" non dipende dalla sotto-categoria: un RAM in GB è
// plausibile nello stesso intervallo ovunque compaia.
const FIXED_NUMBER_RANGES: Record<string, NumRange> = {
	"Altezza tacco": { min: 1, max: 12, decimals: 1 },
	"Campo visivo": { min: 60, max: 170 },
	"Capacità netta": { min: 100, max: 500 },
	"Consumo annuo": { min: 150, max: 400 },
	"Corrente uscita": { min: 1, max: 5, decimals: 1 },
	"Diametro cerchio": { min: 13, max: 22 },
	"Diametro filtro": { min: 37, max: 82 },
	"Diametro ruote": { min: 12, max: 29 },
	"Dimensione schermo": { min: 32, max: 85 },
	DPI: { min: 400, max: 16000 },
	"Durata partita": { min: 10, max: 180 },
	"Flusso luminoso": { min: 200, max: 3000 },
	"Frame rate": { min: 24, max: 240 },
	Garanzia: { min: 12, max: 60 },
	Impedenza: { min: 8, max: 600 },
	"Larghezza pneumatico": { min: 135, max: 315 },
	Luminosità: { min: 250, max: 1600 },
	"Lunghezza focale": { min: 8, max: 600 },
	"Memoria interna": { min: 16, max: 1024 },
	"Memoria/Storage": { min: 128, max: 4000 },
	"Numero bruciatori": { min: 1, max: 6 },
	"Numero giocatori": { min: 1, max: 8 },
	"Numero pezzi": { min: 20, max: 80 },
	"Numero ripiani/cassetti": { min: 1, max: 8 },
	"Numero tasti": { min: 3, max: 12 },
	"Numero velocità": { min: 1, max: 24 },
	"Peso massimo": { min: 9, max: 25 },
	"Peso massimo supportato": { min: 90, max: 150 },
	"Peso prodotto": { min: 5, max: 15 },
	"Portata massima": { min: 20, max: 80 },
	"Potenza uscita": { min: 5, max: 100 },
	RAM: { min: 2, max: 64 },
	"Rapporto d'aspetto": { min: 30, max: 80 },
	"Refresh rate": { min: 60, max: 240 },
	Resa: { min: 5, max: 20 },
	"Risoluzione ottica": { min: 300, max: 6400 },
	"Risoluzione sensore": { min: 8, max: 108 },
	Rumorosità: { min: 30, max: 45 },
	"Superficie cottura": { min: 1000, max: 6000 },
	"Temperatura colore": { min: 2700, max: 6500 },
	"Tempo asciugatura": { min: 1, max: 24 },
	"Tempo di risposta": { min: 1, max: 15 },
	Tensione: { min: 12, max: 230 },
	"Tensione batteria": { min: 4, max: 22 },
	"Tensione ingresso": { min: 100, max: 240 },
	"Tensione uscita": { min: 5, max: 20 },
	Velocità: { min: 1, max: 10 },
	"Velocità scansione": { min: 10, max: 60 },
	"Velocità stampa": { min: 10, max: 60 },
	Volume: { min: 0.1, max: 1, decimals: 1 },
};

function numberRange(name: string, subName: string): NumRange {
	switch (name) {
		case "Peso":
			return weightRangeG(subName);
		case "Larghezza":
		case "Altezza":
		case "Profondità":
			return dimRangeCm(subName);
		case "Potenza":
			return powerRangeW(subName);
		case "Dimensione display":
			return displaySizeRange(subName);
		case "Capacità batteria":
			return batteryCapacityRange(subName);
		case "Autonomia":
			return batteryLifeRange(subName);
		case "Numero porte":
			return portsCountRange(subName);
		default:
			return FIXED_NUMBER_RANGES[name] ?? { min: 1, max: 100 };
	}
}

// ── Una manciata di stringhe plausibili per famiglia (tipo "text") ────────

const DEFAULT_TEXT_POOL = [
	"Non specificato",
	"Standard",
	"Vedi scheda tecnica",
];

const TEXT_POOLS: Record<string, readonly string[]> = {
	Modello: [
		"Serie Classic",
		"Modello Pro",
		"Edizione Standard",
		"Modello Base",
	],
	Tipologia: ["Base", "Avanzata", "Professionale", "Compatta"],
	Materiale: [
		"Cotone",
		"Poliestere",
		"Pelle",
		"Acciaio inossidabile",
		"Alluminio",
		"Legno massello",
		"Plastica riciclata",
	],
	Composizione: [
		"100% cotone",
		"80% cotone, 20% poliestere",
		"Lana merino",
		"Poliestere riciclato",
	],
	Dimensioni: [
		"30 x 20 x 10 cm",
		"45 x 30 x 15 cm",
		"60 x 40 x 20 cm",
		"20 x 15 x 8 cm",
	],
	"Dimensione compatibile": [
		"Universale",
		"Fino a 15 pollici",
		"Fino a 6,7 pollici",
		"Taglia unica",
	],
	"Dimensioni chiuso": [
		"70 x 30 x 20 cm",
		"90 x 40 x 25 cm",
		"60 x 25 x 15 cm",
	],
	"Taglia accessori": ["Taglia unica", "S/M", "M/L", "Regolabile"],
	"Taglia/Misura": ["S", "M", "L", "Regolabile", "Universale"],
	"Diametro/Capacità": ["24 cm / 3 l", "28 cm / 5 l", "20 cm / 2 l"],
	"Risoluzione display": ["1920x1080", "2532x1170", "2560x1440", "3840x2160"],
	Fotocamera: [
		"12 MP grandangolo",
		"48 MP + 12 MP ultra-grandangolo",
		"108 MP quad camera",
		"Doppia fotocamera 12+8 MP",
	],
	Connettività: [
		"Wi-Fi, Bluetooth, NFC",
		"Wi-Fi e Bluetooth",
		"USB-C, Wi-Fi, Bluetooth 5.0",
	],
	Compatibilità: [
		"Compatibile con iOS e Android",
		"Compatibile con Windows e macOS",
		"Universale",
	],
	Protezione: [
		"Vetro Gorilla Glass",
		"IP68 resistente ad acqua e polvere",
		"Custodia rinforzata antiurto",
	],
	Processore: [
		"Octa-core 2.4 GHz",
		"Quad-core 3.2 GHz",
		"Chip Serie A",
		"Processore Snapdragon",
	],
	"Scheda grafica": ["Integrata", "Dedicata 4GB GDDR6", "Dedicata 8GB GDDR6"],
	Porte: [
		"2x USB-A, 1x USB-C, HDMI",
		"3x USB 3.0, jack audio",
		"USB-C, HDMI, lettore SD",
	],
	Batteria: [
		"Li-ion 4000 mAh removibile",
		"Li-Po integrata",
		"Ricaricabile agli ioni di litio",
	],
	"Porte video": ["HDMI, DisplayPort", "HDMI, VGA", "DisplayPort, USB-C"],
	"Risoluzione stampa": ["1200x1200 dpi", "4800x1200 dpi", "600x600 dpi"],
	"Risposta in frequenza": ["20Hz - 20kHz", "15Hz - 22kHz"],
	"Obiettivo/Attacco": [
		"Attacco a baionetta Canon EF",
		"Attacco Nikon F",
		"Attacco universale",
	],
	Zoom: ["Zoom ottico 3x", "Zoom digitale 10x", "Zoom ottico 5x, digitale 20x"],
	ISO: ["100-6400", "100-25600", "64-51200"],
	Attacco: ["E-mount", "F-mount", "EF-mount", "Universale M42"],
	"Apertura massima": ["f/1.8", "f/2.8", "f/4"],
	Sensori: [
		"Accelerometro, giroscopio, GPS",
		"Cardiofrequenzimetro, SpO2, GPS",
	],
	Ingredienti: [
		"Farina di grano duro, acqua",
		"Pomodoro, sale, basilico",
		"Latte, fermenti lattici",
	],
	Allergeni: [
		"Contiene glutine",
		"Può contenere tracce di frutta a guscio",
		"Senza allergeni dichiarati",
		"Contiene lattosio",
	],
	"Valori nutrizionali": [
		"350 kcal per 100g",
		"Energia 1500 kJ / 250 kcal",
		"Proteine 8g, grassi 3g, carboidrati 60g",
	],
	"Paese di origine": ["Italia", "Prodotto in Italia", "Unione Europea"],
	Conservazione: [
		"Conservare in luogo fresco e asciutto",
		"Conservare in frigorifero dopo l'apertura",
		"A temperatura ambiente",
	],
	"Scadenza/TMC": [
		"12 mesi dalla produzione",
		"18 mesi dalla produzione",
		"6 mesi dalla produzione",
	],
	"Formato/Peso netto": ["500 g", "250 g", "1 kg", "750 ml"],
	"Ingredienti principali": [
		"Acido ialuronico",
		"Estratto di aloe vera",
		"Vitamina C",
		"Olio di argan",
	],
	"Gusto/Proteina": ["Pollo", "Manzo", "Salmone", "Agnello e riso"],
	"Beneficio/Funzione": ["Idratante", "Anti-età", "Lenitivo", "Illuminante"],
	Tonalità: [
		"Nude",
		"Rosso classico",
		"Corallo",
		"Biondo naturale 7.0",
		"Castano 4.0",
	],
	"Modalità d'uso": [
		"Applicare mattina e sera su pelle pulita",
		"Massaggiare fino a completo assorbimento",
	],
	Avvertenze: [
		"Evitare il contatto con gli occhi",
		"Non ingerire",
		"Tenere fuori dalla portata dei bambini",
	],
	"Uso previsto": ["Uso quotidiano", "Uso professionale", "Uso occasionale"],
	"Peso bambino": ["0-6 kg", "6-9 kg", "9-15 kg", "15-25 kg"],
	"Sport/Disciplina": [
		"Corsa su strada",
		"Trail running",
		"Palestra",
		"Nuoto",
		"Ciclismo",
	],
	"Misura telaio": [
		"48 cm",
		"52 cm",
		"56 cm",
		"S (160-170 cm)",
		"M (170-180 cm)",
	],
	"Compatibilità veicolo": [
		"Fiat Panda 2012-2020",
		"Volkswagen Golf VII",
		"Universale, adattatori inclusi",
	],
	"Anno compatibilità": ["2015-2020", "2018-2023", "2010-2016"],
	Omologazione: ["ECE R44/04", "ECE R129 (i-Size)", "Omologato CE"],
	"Indice di carico": ["91 (615 kg)", "94 (670 kg)", "98 (750 kg)"],
	"Esigenza specifica": [
		"Pelle sensibile",
		"Articolazioni",
		"Digestione",
		"Energia",
	],
	"Superficie applicabile": [
		"Legno",
		"Muro interno",
		"Metallo",
		"Superfici porose",
	],
	"Istruzioni lavaggio": [
		"Lavaggio in lavatrice a 30°",
		"Solo lavaggio a mano",
		"Lavaggio a secco",
	],
};

// ── Selezione dei prodotti e generazione dei valori ───────

interface EligibleProduct {
	id: string;
	productCategoryId: string;
}

interface CategoryCharacteristic {
	characteristicId: string;
	name: string;
	dataType: CharacteristicDataType;
}

export async function seedCharacteristicValues() {
	const [{ total }] = await db
		.select({ total: count() })
		.from(productCharacteristicValue);
	if (total > 0) {
		console.log("  ⏭ Product characteristic values already seeded, skipping");
		return;
	}

	const [{ matrixTotal }] = await db
		.select({ matrixTotal: count() })
		.from(productCategoryCharacteristic);
	if (matrixTotal === 0) {
		console.log(
			"  ⏭ Category-characteristic matrix empty, skipping characteristic values",
		);
		return;
	}

	// ── Popolazione idonea: prodotti attivi con categoria ──
	const eligible: EligibleProduct[] = (
		await db
			.select({
				id: product.id,
				productCategoryId: product.productCategoryId,
			})
			.from(product)
			.where(
				and(eq(product.status, "active"), isNotNull(product.productCategoryId)),
			)
			.orderBy(asc(product.id))
	).map((r) => ({
		id: r.id,
		productCategoryId: r.productCategoryId as string,
	}));

	if (eligible.length === 0) {
		console.log(
			"  ⏭ No eligible (active, categorized) products, skipping characteristic values",
		);
		return;
	}

	// ── Selezione ~40%: passo coprimo rispetto a N ─────────
	const N = eligible.length;
	const populationStride = coprimeStride(7, N);
	const targetCount = Math.round(N * 0.4);
	const selectedPositions = new Set<number>();
	for (let i = 0; i < targetCount; i++) {
		selectedPositions.add((i * populationStride) % N);
	}
	const selectedProducts = Array.from(selectedPositions)
		.sort((a, b) => a - b)
		.map((pos) => eligible[pos]);

	console.log(
		`  🔧 Valorizzo le caratteristiche di ${selectedProducts.length}/${N} prodotti (${((selectedProducts.length / N) * 100).toFixed(1)}%, passo=${populationStride})...`,
	);

	// ── Caratteristiche per sotto-categoria coinvolta ──────
	const categoryIds = Array.from(
		new Set(selectedProducts.map((p) => p.productCategoryId)),
	);

	const matrixRows = await db
		.select({
			categoryId: productCategoryCharacteristic.productCategoryId,
			characteristicId: productCategoryCharacteristic.characteristicId,
			name: productCharacteristic.name,
			dataType: productCharacteristic.dataType,
		})
		.from(productCategoryCharacteristic)
		.innerJoin(
			productCharacteristic,
			eq(
				productCategoryCharacteristic.characteristicId,
				productCharacteristic.id,
			),
		)
		.where(
			inArray(productCategoryCharacteristic.productCategoryId, categoryIds),
		)
		.orderBy(
			asc(productCategoryCharacteristic.productCategoryId),
			asc(productCategoryCharacteristic.sortOrder),
		);

	const charsByCategory = new Map<string, CategoryCharacteristic[]>();
	for (const r of matrixRows) {
		const arr = charsByCategory.get(r.categoryId) ?? [];
		arr.push({
			characteristicId: r.characteristicId,
			name: r.name,
			dataType: r.dataType,
		});
		charsByCategory.set(r.categoryId, arr);
	}

	// ── Nomi delle sotto-categorie coinvolte (per il contesto "number") ──
	const categoryRows = await db
		.select({ id: productCategory.id, name: productCategory.name })
		.from(productCategory)
		.where(inArray(productCategory.id, categoryIds));
	const categoryNameById = new Map(categoryRows.map((c) => [c.id, c.name]));

	// ── Opzioni delle caratteristiche enum coinvolte ───────
	const enumCharIds = Array.from(
		new Set(
			matrixRows
				.filter((r) => r.dataType === "enum")
				.map((r) => r.characteristicId),
		),
	);
	const optionRows =
		enumCharIds.length > 0
			? await db
					.select({
						id: productCharacteristicOption.id,
						characteristicId: productCharacteristicOption.characteristicId,
						value: productCharacteristicOption.value,
					})
					.from(productCharacteristicOption)
					.where(
						inArray(productCharacteristicOption.characteristicId, enumCharIds),
					)
					.orderBy(asc(productCharacteristicOption.sortOrder))
			: [];
	const optionsByCharacteristic = new Map<
		string,
		{ id: string; value: string }[]
	>();
	for (const o of optionRows) {
		const arr = optionsByCharacteristic.get(o.characteristicId) ?? [];
		arr.push({ id: o.id, value: o.value });
		optionsByCharacteristic.set(o.characteristicId, arr);
	}

	// ── Per ogni prodotto scelto: n caratteristiche (3..totale) ──
	// Passo coprimo rispetto a `totale - 2` (la dimensione dell'intervallo),
	// contato per sotto-categoria: la prima volta che si incontra una
	// sotto-categoria parte da n=3, la successiva avanza di `stride` posizioni
	// nell'intervallo, coprendolo tutto prima di ripetersi.
	const perCategoryCounter = new Map<string, number>();

	function pickCount(categoryId: string, total: number): number {
		const range = total - 2;
		if (range <= 0) return Math.min(3, total);
		const posInCategory = perCategoryCounter.get(categoryId) ?? 0;
		perCategoryCounter.set(categoryId, posInCategory + 1);
		const stride = coprimeStride(5, range);
		return 3 + ((posInCategory * stride) % range);
	}

	/**
	 * Campiona `n` posizioni distinte su `chars` (già ordinato per
	 * `sortOrder`), NON un prefisso: un prefisso fisso raggiungerebbe quasi
	 * mai le caratteristiche di coda (tipicamente i booleani, nel CSV del
	 * Task 2). Passo coprimo rispetto a `chars.length` a partire da un
	 * `offset` che varia per prodotto — così prodotti diversi della stessa
	 * sotto-categoria campionano porzioni diverse della lista, e su tanti
	 * prodotti l'intera lista viene coperta.
	 */
	function sampleCharacteristics(
		chars: CategoryCharacteristic[],
		n: number,
		offset: number,
	): CategoryCharacteristic[] {
		const length = chars.length;
		const stride = coprimeStride(11, length);
		const picked = new Set<number>();
		for (let j = 0; j < n; j++) {
			picked.add((offset + j * stride) % length);
		}
		return Array.from(picked)
			.sort((a, b) => a - b)
			.map((idx) => chars[idx]);
	}

	type ValueInsert = typeof productCharacteristicValue.$inferInsert;
	const valueRows: ValueInsert[] = [];
	// Istogramma "quante caratteristiche per prodotto", per la verifica a
	// secco prima dell'inserimento.
	const countHistogram = new Map<number, number>();

	for (const p of selectedProducts) {
		const chars = charsByCategory.get(p.productCategoryId) ?? [];
		if (chars.length === 0) continue;

		const n = pickCount(p.productCategoryId, chars.length);
		countHistogram.set(n, (countHistogram.get(n) ?? 0) + 1);
		const subName = categoryNameById.get(p.productCategoryId) ?? "";

		const offset = hashSeed(p.id, p.productCategoryId) % chars.length;
		const picked = sampleCharacteristics(chars, n, offset);

		for (const c of picked) {
			const seed = hashSeed(p.id, c.characteristicId);
			const row: ValueInsert = {
				productId: p.id,
				characteristicId: c.characteristicId,
				dataType: c.dataType,
			};

			switch (c.dataType) {
				case "enum": {
					const options = optionsByCharacteristic.get(c.characteristicId) ?? [];
					if (options.length === 0) continue;
					row.optionId = options[seed % options.length].id;
					break;
				}
				case "boolean": {
					row.valueBoolean = seed % 2 === 0;
					break;
				}
				case "number": {
					const range = numberRange(c.name, subName);
					const value = randomInRange(range, seed);
					row.valueNumber = value.toFixed(range.decimals ?? 0);
					break;
				}
				case "text": {
					const pool = TEXT_POOLS[c.name] ?? DEFAULT_TEXT_POOL;
					row.valueText = pool[seed % pool.length];
					break;
				}
			}

			valueRows.push(row);
		}
	}

	// ── Verifica a secco: istogrammi PRIMA di scrivere sul database ──
	console.log(
		"  📊 Istogramma numero di caratteristiche per prodotto:",
		Object.fromEntries(
			[...countHistogram.entries()].sort((a, b) => a[0] - b[0]),
		),
	);
	const typeHistogram = new Map<CharacteristicDataType, number>();
	for (const r of valueRows) {
		typeHistogram.set(r.dataType, (typeHistogram.get(r.dataType) ?? 0) + 1);
	}
	console.log(
		"  📊 Istogramma per data_type:",
		Object.fromEntries(typeHistogram.entries()),
	);

	for (const chunk of chunked(valueRows)) {
		await db.insert(productCharacteristicValue).values(chunk);
	}

	console.log(
		`     ✓ ${valueRows.length} valori su ${selectedProducts.length} prodotti`,
	);
}
