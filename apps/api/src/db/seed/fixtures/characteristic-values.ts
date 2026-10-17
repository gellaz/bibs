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
import { productMacroCategory } from "@/db/schemas/product-macro-category";
import { catalogEntryByName } from "./catalog";

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
 * Per ogni prodotto scelto restano candidate le caratteristiche della sua
 * sotto-categoria che il prodotto non salta (`skippedCharacteristics`) e per
 * cui il seed ha valori coerenti con la sotto-categoria (`CONTEXT_POOLS`,
 * `VALUE_POOLS`, `numberRange`): niente valore è meglio di un valore che
 * contraddice il nome. Fra le candidate se ne valorizzano `n`, fra 3 e il
 * totale, scelto con lo stesso schema a passo coprimo (stavolta rispetto a
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

// ── Caratteristiche che il prodotto non deve avere ────────

const FOOD = "Alimentari e bevande";
/** Un alimento non ha modello, colore, materiale, ingombro né peso lordo. */
const NOT_FOR_FOOD = ["Modello", "Colore", "Materiale", "Dimensioni", "Peso"];
/** «500 g», «75 cl», «1,5 l»: il nome dichiara già peso e formato. */
const QUANTITY = /\b\d+(?:[.,]\d+)?\s?(g|kg|ml|cl|l)\b/i;
const SIZED = ["Peso", "Formato/Peso netto", "Capacità netta"];

/**
 * Le caratteristiche da non valorizzare su un prodotto del seed: quelle da
 * oggetto sugli alimenti, peso e formato quando il nome li dichiara, e lo
 * `skip` della sua voce di catalogo (non si applica o è già nel nome).
 */
export function skippedCharacteristics(
	macro: string,
	sub: string,
	productName: string,
): ReadonlySet<string> {
	const entry = catalogEntryByName(productName);
	const skipped = new Set(
		entry?.macro === macro && entry.sub === sub ? entry.skip : [],
	);
	if (macro === FOOD) for (const c of NOT_FOR_FOOD) skipped.add(c);
	if (QUANTITY.test(productName)) for (const c of SIZED) skipped.add(c);
	return skipped;
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

// Le tabelle sotto sono chiavate sul solo NOME della sotto-categoria, non
// sulla coppia (macro, sotto-categoria): due nomi si ripetono sotto macro
// diverse nella matrice ("Stampanti", "Pennelli") e lì l'oggetto è lo stesso.
// Se servisse distinguerli, la chiave deve diventare (macroName, subName).

/**
 * "Peso" (g) per sotto-categoria. Fuori da qui non si valorizza: dove gli
 * oggetti della stessa sotto-categoria pesano da pochi grammi a decine di
 * chili (bici da bambino ed e-bike, pochette e valigie) un intervallo unico
 * contraddirebbe metà dei nomi.
 */
const WEIGHT_RANGES_G: Record<string, NumRange> = {
	Smartphone: { min: 150, max: 230 },
	Tablet: { min: 300, max: 600 },
	Laptop: { min: 1600, max: 2400 },
	Monitor: { min: 4000, max: 7500 },
	"Smart TV": { min: 14000, max: 20000 },
	Console: { min: 300, max: 700 },
	Cuffie: { min: 180, max: 350 },
	Auricolari: { min: 4, max: 60 },
	Smartwatch: { min: 30, max: 70 },
	"Fitness tracker": { min: 20, max: 40 },
	Mouse: { min: 60, max: 130 },
	Tastiere: { min: 700, max: 1300 },
	Webcam: { min: 80, max: 200 },
	"Speaker Bluetooth": { min: 300, max: 1000 },
	"Power bank": { min: 120, max: 450 },
	Caricabatterie: { min: 30, max: 150 },
	eReader: { min: 150, max: 250 },
	Droni: { min: 250, max: 900 },
	"Action cam": { min: 100, max: 200 },
	"Custodie smartphone": { min: 15, max: 80 },
	Stampanti: { min: 5000, max: 11000 },
	"Occhiali da sole": { min: 20, max: 50 },
	Cinture: { min: 100, max: 350 },
	"Scarpe donna": { min: 400, max: 1200 },
	"Scarpe uomo": { min: 600, max: 1200 },
	Sneakers: { min: 500, max: 1000 },
	Zaini: { min: 600, max: 1500 },
	"Piccoli elettrodomestici": { min: 600, max: 2000 },
	"Macchine caffè": { min: 4000, max: 9000 },
	"Rasoi elettrici": { min: 60, max: 300 },
	"Batterie auto": { min: 14000, max: 20000 },
	Pneumatici: { min: 7000, max: 10000 },
	Trasportini: { min: 800, max: 3000 },
	Cucce: { min: 800, max: 4000 },
};

/**
 * "Larghezza"/"Altezza"/"Profondità" (cm), dove gli oggetti si somigliano.
 * Fuori da qui (vasi e portaombrelli, bollitori e frullatori) tre misure a
 * caso non fanno una forma, e non si valorizzano.
 */
const DIM_RANGES_CM: Record<string, NumRange> = {
	"Biancheria letto": { min: 130, max: 260 },
	Candele: { min: 5, max: 20 },
	Forni: { min: 45, max: 90 },
	"Macchine caffè": { min: 20, max: 45 },
	"Mobili camera": { min: 40, max: 220 },
	"Mobili cucina": { min: 40, max: 240 },
	"Mobili soggiorno": { min: 40, max: 250 },
	Padelle: { min: 16, max: 34 },
	Pentole: { min: 14, max: 40 },
	Quadri: { min: 15, max: 100 },
	"Robot cucina": { min: 18, max: 42 },
	Tappeti: { min: 60, max: 300 },
	Tende: { min: 100, max: 300 },
	Scrivanie: { min: 50, max: 160 },
};
/** Le padelle sono larghe, non alte. */
const HEIGHT_RANGES_CM: Record<string, NumRange> = {
	Padelle: { min: 3, max: 7 },
};

/** "Potenza" (W): lampadine, elettrodomestici da cucina, barbecue, elettronica. */
function powerRangeW(subName: string): NumRange {
	if (subName === "Illuminazione" || subName === "Lampade")
		return { min: 3, max: 100 };
	if (subName === "Utensili cucina") return { min: 300, max: 2000 };
	if (subName === "Macchine caffè") return { min: 900, max: 1500 };
	if (subName === "Barbecue") return { min: 1500, max: 3000 };
	if (["Domotica", "Sicurezza smart", "Action cam"].includes(subName))
		return { min: 3, max: 15 };
	if (
		["Console", "Speaker Bluetooth", "Caricabatterie", "Droni"].includes(
			subName,
		)
	)
		return { min: 10, max: 60 };
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
	if (subName === "Caricabatterie") return { min: 1, max: 3 };
	return { min: 1, max: 4 };
}

/** Number che cambiano ordine di grandezza con la sotto-categoria. */
const RANGES_BY_SUB: Record<string, Record<string, NumRange>> = {
	"Gradazione alcolica": {
		Vino: { min: 11, max: 15, decimals: 1 },
		Birra: { min: 4, max: 9, decimals: 1 },
		"Liquori e distillati": { min: 20, max: 45, decimals: 1 },
	},
	Stagionatura: {
		Salumi: { min: 2, max: 24 },
		"Formaggi e latticini": { min: 1, max: 36 },
	},
	"Capacità netta": {
		Vino: { min: 0.375, max: 1.5, decimals: 2 },
		Birra: { min: 0.33, max: 0.75, decimals: 2 },
		"Liquori e distillati": { min: 0.5, max: 1, decimals: 2 },
		"Olio e condimenti": { min: 0.25, max: 1, decimals: 2 },
	},
	"Altezza tacco": {
		"Scarpe donna": { min: 3, max: 10 },
		"Scarpe uomo": { min: 1, max: 3 },
		Sneakers: { min: 2, max: 4 },
	},
	// 28" = 700c: corsa, gravel, trekking, città. Le altre misure stanno nel nome.
	"Diametro ruote": { Biciclette: { min: 28, max: 28 } },
};

// Il resto dei "number" non dipende dalla sotto-categoria: un RAM in GB è
// plausibile nello stesso intervallo ovunque compaia.
const FIXED_NUMBER_RANGES: Record<string, NumRange> = {
	"Altezza tacco": { min: 1, max: 12, decimals: 1 },
	Annata: { min: 2015, max: 2024 },
	"Consumo annuo": { min: 150, max: 400 },
	"Corrente uscita": { min: 1, max: 5, decimals: 1 },
	"Diametro cerchio": { min: 13, max: 22 },
	"Diametro filtro": { min: 37, max: 82 },
	"Diametro ruote": { min: 12, max: 29 },
	"Dimensione schermo": { min: 32, max: 85 },
	"Durata partita": { min: 15, max: 60 },
	"Flusso luminoso": { min: 200, max: 3000 },
	Impedenza: { min: 16, max: 64 },
	"Larghezza pneumatico": { min: 135, max: 315 },
	Luminosità: { min: 250, max: 1600 },
	"Lunghezza focale": { min: 8, max: 600 },
	"Memoria interna": { min: 16, max: 1024 },
	"Memoria/Storage": { min: 128, max: 4000 },
	"Numero bruciatori": { min: 1, max: 6 },
	"Numero giocatori": { min: 2, max: 6 },
	"Numero pezzi": { min: 20, max: 80 },
	"Numero ripiani/cassetti": { min: 1, max: 8 },
	"Numero tasti": { min: 3, max: 12 },
	"Peso massimo": { min: 9, max: 25 },
	"Peso massimo supportato": { min: 90, max: 150 },
	"Peso prodotto": { min: 5, max: 15 },
	Porzioni: { min: 1, max: 4 },
	"Portata massima": { min: 20, max: 80 },
	"Potenza uscita": { min: 10, max: 30 },
	RAM: { min: 2, max: 64 },
	"Rapporto d'aspetto": { min: 30, max: 80 },
	Resa: { min: 5, max: 20 },
	"Risoluzione ottica": { min: 300, max: 6400 },
	"Risoluzione sensore": { min: 8, max: 108 },
	Rumorosità: { min: 30, max: 45 },
	"Superficie cottura": { min: 1000, max: 6000 },
	"Tempo asciugatura": { min: 1, max: 24 },
	"Tensione batteria": { min: 4, max: 22 },
	Velocità: { min: 1, max: 10 },
	"Velocità scansione": { min: 10, max: 60 },
	Volume: { min: 0.1, max: 1, decimals: 1 },
};

/** `undefined`: il seed non ha un intervallo coerente per questa sotto-categoria. */
function numberRange(name: string, subName: string): NumRange | undefined {
	switch (name) {
		case "Peso":
			return WEIGHT_RANGES_G[subName];
		case "Larghezza":
		case "Profondità":
			return DIM_RANGES_CM[subName];
		case "Altezza":
			return HEIGHT_RANGES_CM[subName] ?? DIM_RANGES_CM[subName];
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
			return (
				RANGES_BY_SUB[name]?.[subName] ??
				FIXED_NUMBER_RANGES[name] ?? { min: 1, max: 100 }
			);
	}
}

// ── Pool di valori e opzioni ammesse ───────────────────────

const COLORI_OGGETTI = [
	"Nero",
	"Bianco",
	"Grigio",
	"Rosso",
	"Verde",
	"Blu",
	"Giallo",
	"Arancione",
];

/**
 * Pool dei "text" e dei "number" e opzioni ammesse degli "enum", per nome.
 * Un text senza pool non si valorizza: Modello, Materiale, Dimensioni,
 * Tipologia, Compatibilità hanno valori sensati solo in qualche
 * sotto-categoria (`CONTEXT_POOLS`), e ingredienti, allergeni e valori
 * nutrizionali sono propri di ogni prodotto.
 */
const VALUE_POOLS: Record<string, readonly string[]> = {
	Colore: COLORI_OGGETTI,
	// Number con pochi valori tipici: un intervallo darebbe «garanzia 41 mesi».
	Garanzia: ["12", "24", "36"],
	"Refresh rate": ["60", "75", "144", "165", "240"],
	"Tempo di risposta": ["1", "4", "5"],
	DPI: ["800", "1600", "3200", "4000"],
	"Frame rate": ["30", "60"],
	"Campo visivo": ["78", "90"],
	"Velocità stampa": ["15", "20", "30"],
	Tensione: ["230"],
	"Tensione ingresso": ["230"],
	"Tensione uscita": ["5", "9", "12", "20"],
	"Temperatura colore": ["2700", "3000", "4000", "6500"],
	"Numero velocità": ["7", "8", "11", "21"],
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
	"Dimensione compatibile": ["Fino a 6,1 pollici", "Fino a 6,7 pollici"],
	Protezione: ["Antiurto", "Antigraffio", "Bordi rialzati sullo schermo"],
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
	"Paese di origine": ["Italia", "Prodotto in Italia", "Unione Europea"],
	// Dispensa: i freschi e i surgelati hanno i loro in CONTEXT_POOLS.
	Conservazione: [
		"Conservare in luogo fresco e asciutto",
		"Al riparo dalla luce e da fonti di calore",
	],
	"Scadenza/TMC": [
		"12 mesi dalla produzione",
		"18 mesi dalla produzione",
		"24 mesi dalla produzione",
	],
	"Formato/Peso netto": ["250 g", "500 g", "1 kg"],
	// Solo grano tenero: semola, segale e integrale li dice già il nome del pane.
	"Tipo di farina": [
		"Farina di grano tenero tipo 0",
		"Farina di grano tenero tipo 00",
		"Farina di grano tenero tipo 1",
		"Farina di grano tenero tipo 2",
		"Farine di grano tenero tipo 0 e tipo 1",
	],
	Taglio: [
		"Filetto",
		"Controfiletto",
		"Lombata",
		"Fesa",
		"Noce",
		"Girello",
		"Petto",
		"Coscia",
	],
	"Specie ittica": [
		"Orata (Sparus aurata)",
		"Branzino (Dicentrarchus labrax)",
		"Salmone (Salmo salar)",
		"Merluzzo (Gadus morhua)",
		"Pesce spada (Xiphias gladius)",
		"Alice (Engraulis encrasicolus)",
	],
	Vitigno: [
		"Sangiovese",
		"Nebbiolo",
		"Barbera",
		"Montepulciano",
		"Primitivo",
		"Trebbiano",
		"Vermentino",
		"Glera",
	],
	Gusto: [
		"Pistacchio",
		"Nocciola",
		"Cioccolato",
		"Fior di latte",
		"Stracciatella",
		"Fragola",
		"Limone",
		"Caffè",
	],
	"Ingredienti principali": [
		"Acido ialuronico",
		"Estratto di aloe vera",
		"Vitamina C",
		"Olio di argan",
	],
	"Gusto/Proteina": ["Pollo", "Manzo", "Salmone", "Agnello e riso"],
	"Beneficio/Funzione": ["Idratante", "Anti-età", "Lenitivo", "Nutriente"],
	Avvertenze: [
		"Non adatto a bambini di età inferiore a 36 mesi",
		"Contiene piccole parti",
		"Da usare sotto la sorveglianza di un adulto",
	],
	"Peso bambino": ["0-6 kg", "6-9 kg", "9-15 kg", "15-25 kg"],
	"Taglia accessori": ["Taglia unica", "S/M", "M/L", "Regolabile"],
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
	Omologazione: ["Omologato CE", "Conforme alle normative UE"],
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
	"Diametro/Capacità": ["24 cm / 3 l", "28 cm / 5 l", "20 cm / 2 l"],
};

const STAGIONI = ["Primavera/Estate", "Autunno/Inverno", "Tutto l'anno"];
const COMPOSIZIONE = [
	"100% cotone",
	"80% cotone, 20% poliestere",
	"Lana merino",
	"Poliestere riciclato",
];
const CAPELLI = [
	"Capelli normali",
	"Capelli secchi",
	"Capelli grassi",
	"Capelli fini",
	"Tutti i tipi",
];
const PELLE = [
	"Pelle normale",
	"Pelle secca",
	"Pelle grassa",
	"Pelle mista",
	"Pelle sensibile",
	"Tutti i tipi",
];
const PER_CAPELLI = {
	"Tipo pelle/capelli": CAPELLI,
	"Beneficio/Funzione": ["Nutriente", "Rinforzante", "Anticrespo", "Lucidante"],
	"Ingredienti principali": [
		"Cheratina",
		"Olio di argan",
		"Proteine della seta",
		"Estratto di aloe vera",
	],
};
const NON_COSMETICO = {
	"Tipo pelle/capelli": [],
	"Beneficio/Funzione": [],
	"Ingredienti principali": [],
};
const PIATTAFORME = [
	"PlayStation 5",
	"Xbox Series X|S",
	"Nintendo Switch",
	"PC",
];
const CASA_SMART = [
	"Compatibile con Alexa e Google Home",
	"Compatibile con Apple Home",
];
/** Freschi venduti al banco: niente formato a scaffale né scadenza in mesi. */
const AL_BANCO = { "Formato/Peso netto": [], "Scadenza/TMC": [] };
const FRIGO = { ...AL_BANCO, Conservazione: ["In frigorifero tra 0 e 4 °C"] };

/**
 * Valori ammessi per sotto-categoria o macro (la sotto-categoria vince),
 * prima di `VALUE_POOLS`: pool dei text e dei number, opzioni ammesse degli
 * enum, `[]` per non valorizzare affatto. Le opzioni degli enum devono
 * esistere nel dizionario: il seed si ferma se non le trova.
 */
const CONTEXT_POOLS: Record<string, Record<string, readonly string[]>> = {
	// ── Per macro ──
	Elettronica: {
		Colore: ["Nero", "Bianco", "Grigio", "Argento", "Blu"],
		Modello: [
			"Serie Classic",
			"Modello Pro",
			"Edizione Standard",
			"Modello Base",
		],
		Materiale: ["Alluminio", "Plastica riciclata", "Policarbonato"],
		Alimentazione: [
			"Rete elettrica",
			"Batteria integrata",
			"Pile sostituibili",
			"USB",
		],
		Compatibilità: [
			"Compatibile con iOS e Android",
			"Compatibile con Windows e macOS",
			"Universale",
		],
	},
	Abbigliamento: {
		Colore: [
			"Nero",
			"Bianco",
			"Grigio",
			"Beige",
			"Marrone",
			"Rosso",
			"Rosa",
			"Verde",
			"Blu",
			"Azzurro",
		],
		Genere: ["Uomo", "Donna", "Unisex"],
		Vestibilità: [],
		Stagione: ["Tutto l'anno"],
	},
	"Casa e cucina": { "Montaggio richiesto": [] },
	"Libri e media": { Colore: [] },
	"Bellezza e cura personale": { Colore: [] },
	// ── Abbigliamento ──
	"Abbigliamento donna": {
		Genere: ["Donna"],
		Vestibilità: ["Slim", "Regular", "Comoda"],
		Stagione: STAGIONI,
		Composizione: COMPOSIZIONE,
	},
	"Abbigliamento uomo": {
		Genere: ["Uomo"],
		Vestibilità: ["Slim", "Regular", "Comoda"],
		Stagione: STAGIONI,
		Composizione: COMPOSIZIONE,
	},
	Intimo: {
		Vestibilità: ["Aderente", "Regular"],
		Stagione: STAGIONI,
		Composizione: COMPOSIZIONE,
	},
	"Scarpe donna": {
		Genere: ["Donna"],
		"Taglia calzature": ["35", "36", "37", "38", "39", "40", "41"],
		"Materiale suola": ["Cuoio", "Gomma"],
		"Tipo chiusura": ["Senza chiusura", "Fibbia", "Zip"],
	},
	"Scarpe uomo": {
		Genere: ["Uomo"],
		"Taglia calzature": ["39", "40", "41", "42", "43", "44", "45", "46"],
		"Materiale suola": ["Cuoio", "Gomma"],
	},
	Sneakers: {
		"Materiale tomaia": ["Mesh", "Tessuto", "Sintetico"],
		"Materiale suola": ["Gomma", "EVA"],
		"Tipo chiusura": ["Lacci"],
	},
	Gioielli: { "Taglia accessori": [], Genere: ["Donna", "Unisex"] },
	// Borselli e marsupi grandi come valigie no.
	Borse: { "Taglia bagagli": ["Piccola", "Media"] },
	Zaini: { "Taglia bagagli": ["Piccola", "Media"] },
	"Occhiali da sole": {
		"Taglia accessori": ["Taglia unica"],
		Stagione: ["Primavera/Estate", "Tutto l'anno"],
	},
	Orologi: { "Resistenza acqua": ["3 ATM", "5 ATM", "10 ATM"] },
	// ── Elettronica ──
	Smartphone: {
		"Sistema operativo": ["Android"],
		"Tipo connettore": ["USB-C"],
		"Risoluzione display": ["2400x1080", "2340x1080", "2412x1080"],
		RAM: ["4", "6", "8", "12"],
	},
	Tablet: {
		"Sistema operativo": ["Android", "iPadOS", "Windows"],
		"Risoluzione display": ["1920x1200", "2000x1200", "2560x1600"],
		RAM: ["4", "6", "8"],
	},
	Laptop: {
		"Sistema operativo": ["Windows", "macOS", "ChromeOS", "Linux"],
		RAM: ["8", "16", "32"],
		"Tipo storage": ["SSD"],
	},
	Smartwatch: {
		"Sistema operativo": ["watchOS", "Wear OS", "HarmonyOS"],
		"Tipo display": ["AMOLED", "OLED", "LCD"],
	},
	"Fitness tracker": {
		"Sistema operativo": [],
		"Tipo display": ["AMOLED", "OLED", "LCD"],
	},
	eReader: {
		"Sistema operativo": ["Linux", "Android"],
		"Risoluzione display": ["1072x1448", "1264x1680"],
		RAM: ["1", "2"],
		"Memoria interna": ["8", "16", "32"],
	},
	"Smart TV": {
		"Sistema operativo": ["Android TV", "Tizen", "webOS", "Fire OS"],
	},
	"Custodie smartphone": {
		Compatibilità: [
			"Per iPhone 15",
			"Per Samsung Galaxy S24",
			"Per Google Pixel 8",
		],
		"Tipo chiusura": ["Magnetica", "Senza chiusura"],
	},
	Caricabatterie: { "Tipo connettore": ["USB-C", "USB-A", "Micro USB"] },
	"Power bank": { "Tipo connettore": ["USB-C", "USB-A", "Micro USB"] },
	Domotica: { Alimentazione: ["Rete elettrica"], Compatibilità: CASA_SMART },
	"Sicurezza smart": {
		Alimentazione: ["Rete elettrica", "Batteria integrata"],
		Compatibilità: CASA_SMART,
	},
	Videogiochi: { Compatibilità: PIATTAFORME },
	"Accessori console": {
		Alimentazione: ["Batteria integrata", "Pile sostituibili"],
		Compatibilità: PIATTAFORME,
	},
	Console: { Alimentazione: ["Batteria integrata"], Compatibilità: [] },
	Droni: {
		Alimentazione: ["Batteria integrata"],
		Compatibilità: ["Compatibile con iOS e Android"],
	},
	"Action cam": {
		Alimentazione: ["Batteria integrata"],
		Compatibilità: ["Compatibile con iOS e Android"],
	},
	"Speaker Bluetooth": {
		Alimentazione: ["Batteria integrata"],
		Connessione: ["Bluetooth"],
		"Canali audio": ["Mono", "Stereo"],
	},
	Mouse: { Alimentazione: ["Batteria integrata", "Pile sostituibili"] },
	Tastiere: { Alimentazione: ["USB"], Connessione: ["Cablata"], Wireless: [] },
	Webcam: {
		Connessione: ["Cablata"],
		Compatibilità: ["Compatibile con Windows e macOS"],
	},
	Stampanti: { "Formato carta": ["A4"], "Wi-Fi": ["Wi-Fi 4", "Wi-Fi 5"] },
	Cuffie: { Connessione: ["Wireless", "Bluetooth"] },
	Auricolari: { Connessione: ["Wireless", "Bluetooth"] },
	// ── Bellezza ──
	Shampoo: {
		...PER_CAPELLI,
		Formato: ["Liquido", "Gel"],
		"Modalità d'uso": [
			"Applicare sui capelli bagnati, massaggiare e risciacquare",
		],
	},
	Balsamo: {
		...PER_CAPELLI,
		Formato: ["Crema", "Liquido"],
		"Modalità d'uso": [
			"Distribuire sulle lunghezze, lasciare in posa qualche minuto e risciacquare",
		],
	},
	// Lacca, cera, gel: la funzione è il prodotto stesso.
	"Styling capelli": { ...PER_CAPELLI, "Beneficio/Funzione": [] },
	"Creme viso": { Formato: ["Crema", "Gel"], "Tipo pelle/capelli": PELLE },
	Sieri: { "Tipo pelle/capelli": PELLE },
	Integratori: { ...NON_COSMETICO, Formato: ["Compresse", "Capsule"] },
	Vitamine: { ...NON_COSMETICO, Formato: ["Compresse", "Capsule"] },
	"Profumi donna": { ...NON_COSMETICO, Formato: ["Spray"] },
	"Profumi uomo": { ...NON_COSMETICO, Formato: ["Spray"] },
	"Rasoi elettrici": NON_COSMETICO,
	"Make-up labbra": {
		Tonalità: ["Nude", "Rosso classico", "Corallo", "Rosa antico"],
		Effetto: ["Rimpolpante", "Idratante"],
	},
	"Make-up occhi": {
		Tonalità: ["Nero", "Marrone", "Grigio fumo", "Bronzo"],
		Effetto: [],
	},
	"Make-up viso": {
		Tonalità: ["Avorio", "Beige naturale", "Sabbia", "Ambra"],
		Finish: ["Matte", "Satinato", "Luminoso", "Naturale"],
		Effetto: ["Coprente", "Illuminante", "Opacizzante", "Idratante"],
	},
	// ── Alimentari ──
	Carne: { ...FRIGO, "Fresco o surgelato": ["Fresco"] },
	Pesce: {
		...FRIGO,
		"Scadenza/TMC": ["Da consumare entro 2 giorni dall'acquisto"],
		"Fresco o surgelato": ["Fresco"],
		"Pescato o allevato": ["Pescato"],
	},
	"Piatti pronti": {
		...AL_BANCO,
		Conservazione: [],
		"Fresco o surgelato": ["Fresco"],
	},
	Salumi: {
		...AL_BANCO,
		Conservazione: ["In frigorifero tra 4 e 8 °C"],
		Denominazione: ["Nessuna"],
	},
	"Formaggi e latticini": {
		...AL_BANCO,
		Conservazione: ["In frigorifero tra 4 e 8 °C"],
		Denominazione: ["Nessuna"],
	},
	"Pane e prodotti da forno": {
		...AL_BANCO,
		Conservazione: ["In luogo asciutto, in un sacchetto di carta"],
	},
	Gelati: { ...AL_BANCO, Conservazione: ["In freezer a -18 °C"] },
	// Pasta fresca e secca nella stessa sotto-categoria.
	Pasta: { Conservazione: [], "Scadenza/TMC": [] },
	Vino: { "Scadenza/TMC": [] },
	Birra: { "Scadenza/TMC": [] },
	"Liquori e distillati": { "Scadenza/TMC": [] },
	"Olio e condimenti": { Denominazione: ["Nessuna"] },
	// ── Altro ──
	Fiori: {
		Colore: ["Bianco", "Rosso", "Rosa", "Giallo", "Arancione", "Viola"],
	},
	Piante: { Colore: [] },
	Semi: { Colore: [] },
	"Materiali edilizia": { Colore: [] },
	Cartucce: { Colore: [] },
	Colori: { Colore: [] },
	"Cibo cani": { Colore: [] },
	"Cibo gatti": { Colore: [] },
	"Snack animali": { Colore: [] },
	"Prodotti igiene": { Colore: [] },
	Pannolini: { Colore: [] },
	"Prodotti allattamento": { Colore: [] },
	"Kit fai da te": { Colore: [] },
	"Utensili cucina": { "Diametro/Capacità": [] },
	// Tegame basso, pentola per la pasta alta: niente altezza unica.
	Pentole: { Altezza: [] },
	Lampade: {
		"Tipo sorgente luminosa": ["LED", "Alogena", "Incandescenza"],
		"Grado IP": ["IP20", "IP44"],
	},
	"Sport acquatici": { "Taglia/Misura": ["S", "M", "L", "Regolabile"] },
	"Sport invernali": { "Taglia/Misura": ["S", "M", "L", "Regolabile"] },
	Biciclette: {
		"Tipo freni": ["A disco idraulici", "A disco meccanici", "A pattino"],
		Sospensioni: ["Rigida", "Anteriore"],
	},
	// L'età va dal puzzle da 24 pezzi al piccolo chimico: niente valore unico.
	"Giocattoli educativi": {
		"Età consigliata": [],
		"Batterie richieste": [],
		Lingua: ["Italiano", "Multilingue", "Senza testo"],
	},
	"Accessori interni auto": { "Posizione montaggio": ["Interno"] },
	"Accessori esterni auto": {
		"Posizione montaggio": ["Esterno"],
		Colore: ["Nero", "Grigio"],
	},
	// Gomme nere, ricambi e oli: il colore non è una scelta.
	Pneumatici: { Colore: [] },
	"Oli motore": { Colore: [] },
	"Ricambi meccanici": { "Posizione montaggio": [], Colore: [] },
	"Accessori moto": {
		"Posizione montaggio": ["Esterno"],
		"Compatibilità veicolo": [
			"Honda SH 125",
			"Piaggio Beverly 300",
			"Yamaha T-Max 560",
		],
	},
	"Caschi moto": { Omologazione: ["ECE 22.06"] },
};

function allowedValues(
	name: string,
	macro: string,
	sub: string,
): readonly string[] | undefined {
	return (
		CONTEXT_POOLS[sub]?.[name] ??
		CONTEXT_POOLS[macro]?.[name] ??
		VALUE_POOLS[name]
	);
}

// ── Selezione dei prodotti e generazione dei valori ───────

interface EligibleProduct {
	id: string;
	name: string;
	productCategoryId: string;
}

interface CategoryCharacteristic {
	characteristicId: string;
	name: string;
	dataType: CharacteristicDataType;
}

type ValueInsert = typeof productCharacteristicValue.$inferInsert;

/** Una caratteristica valorizzabile nella sua sotto-categoria. */
interface Candidate extends CategoryCharacteristic {
	value: (seed: number) => Partial<ValueInsert>;
}

function candidate(
	c: CategoryCharacteristic,
	macro: string,
	sub: string,
	options: { id: string; value: string }[],
): Candidate | null {
	const allowed = allowedValues(c.name, macro, sub);
	if (allowed?.length === 0) return null;
	switch (c.dataType) {
		case "enum": {
			const missing = (allowed ?? []).filter(
				(v) => !options.some((o) => o.value === v),
			);
			if (missing.length > 0)
				throw new Error(
					`seedCharacteristicValues: '${c.name}' non ha le opzioni ${missing.join(", ")} (${sub})`,
				);
			const opts = allowed
				? options.filter((o) => allowed.includes(o.value))
				: options;
			if (opts.length === 0) return null;
			return {
				...c,
				value: (seed) => ({ optionId: opts[seed % opts.length].id }),
			};
		}
		case "boolean":
			return { ...c, value: (seed) => ({ valueBoolean: seed % 2 === 0 }) };
		case "number": {
			// Valori tipici (8 GB, 24 mesi, 144 Hz) invece di un «RAM 11 GB».
			if (allowed)
				return {
					...c,
					value: (seed) => ({ valueNumber: allowed[seed % allowed.length] }),
				};
			const range = numberRange(c.name, sub);
			if (!range) return null;
			return {
				...c,
				value: (seed) => ({
					valueNumber: randomInRange(range, seed).toFixed(range.decimals ?? 0),
				}),
			};
		}
		case "text": {
			if (!allowed) return null;
			return {
				...c,
				value: (seed) => ({ valueText: allowed[seed % allowed.length] }),
			};
		}
	}
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
				name: product.name,
				productCategoryId: product.productCategoryId,
			})
			.from(product)
			.where(
				and(eq(product.status, "active"), isNotNull(product.productCategoryId)),
			)
			.orderBy(asc(product.id))
	).map((r) => ({
		id: r.id,
		name: r.name,
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
			// Tie-break: sortOrder deriva dalla posizione nel file d'import e non
			// e' toccato dagli import successivi, quindi due righe possono
			// condividere lo stesso (categoria, sortOrder). Il nome rende
			// l'ordine deterministico anche in quel caso.
			asc(productCharacteristic.name),
		);

	// ── Nomi di sotto-categoria e macro coinvolte ──
	const categoryRows = await db
		.select({
			id: productCategory.id,
			sub: productCategory.name,
			macro: productMacroCategory.name,
		})
		.from(productCategory)
		.innerJoin(
			productMacroCategory,
			eq(productMacroCategory.id, productCategory.macroCategoryId),
		)
		.where(inArray(productCategory.id, categoryIds));
	const categoryById = new Map(categoryRows.map((c) => [c.id, c]));

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

	// ── Candidate per sotto-categoria, nell'ordine della matrice ──
	const candidatesByCategory = new Map<string, Candidate[]>();
	for (const r of matrixRows) {
		const cat = categoryById.get(r.categoryId);
		if (!cat) continue;
		const c = candidate(
			r,
			cat.macro,
			cat.sub,
			optionsByCharacteristic.get(r.characteristicId) ?? [],
		);
		if (!c) continue;
		const arr = candidatesByCategory.get(r.categoryId) ?? [];
		arr.push(c);
		candidatesByCategory.set(r.categoryId, arr);
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
	function sampleCharacteristics<T>(
		chars: T[],
		n: number,
		offset: number,
	): T[] {
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

	const valueRows: ValueInsert[] = [];
	// Istogramma "quante caratteristiche per prodotto", per la verifica a
	// secco prima dell'inserimento.
	const countHistogram = new Map<number, number>();

	for (const p of selectedProducts) {
		const cat = categoryById.get(p.productCategoryId);
		if (!cat) continue;
		// Le saltate escono prima di contare e campionare.
		const skipped = skippedCharacteristics(cat.macro, cat.sub, p.name);
		const chars = (candidatesByCategory.get(p.productCategoryId) ?? []).filter(
			(c) => !skipped.has(c.name),
		);
		if (chars.length === 0) continue;

		const n = pickCount(p.productCategoryId, chars.length);
		const offset = hashSeed(p.id, p.productCategoryId) % chars.length;
		const picked = sampleCharacteristics(chars, n, offset);

		for (const c of picked) {
			valueRows.push({
				productId: p.id,
				characteristicId: c.characteristicId,
				dataType: c.dataType,
				...c.value(hashSeed(p.id, c.characteristicId)),
			});
		}
		countHistogram.set(
			picked.length,
			(countHistogram.get(picked.length) ?? 0) + 1,
		);
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
