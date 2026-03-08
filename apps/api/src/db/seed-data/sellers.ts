import type { VatStatus } from "@/db/schemas/organization";
import type { OnboardingStatus } from "@/db/schemas/seller";

// ── Helpers ───────────────────────────────────────────────

function pick<T>(arr: readonly T[], idx: number, stride = 1, offset = 0): T {
	return arr[(idx * stride + offset) % arr.length];
}

// ── Italian first names ───────────────────────────────────

const firstNames = [
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

const lastNames = [
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

// ── Italian cities with real coordinates ──────────────────

interface CityData {
	name: string;
	province: string;
	zip: string;
	lat: number;
	lng: number;
}

const cities: readonly CityData[] = [
	{ name: "Milano", province: "MI", zip: "20121", lat: 45.4642, lng: 9.19 },
	{ name: "Roma", province: "RM", zip: "00185", lat: 41.9028, lng: 12.4964 },
	{
		name: "Napoli",
		province: "NA",
		zip: "80121",
		lat: 40.8518,
		lng: 14.2681,
	},
	{
		name: "Torino",
		province: "TO",
		zip: "10121",
		lat: 45.0703,
		lng: 7.6869,
	},
	{
		name: "Firenze",
		province: "FI",
		zip: "50121",
		lat: 43.7696,
		lng: 11.2558,
	},
	{
		name: "Bologna",
		province: "BO",
		zip: "40121",
		lat: 44.4949,
		lng: 11.3426,
	},
	{
		name: "Palermo",
		province: "PA",
		zip: "90121",
		lat: 38.1157,
		lng: 13.3615,
	},
	{
		name: "Genova",
		province: "GE",
		zip: "16121",
		lat: 44.4056,
		lng: 8.9463,
	},
	{
		name: "Catania",
		province: "CT",
		zip: "95121",
		lat: 37.5079,
		lng: 15.083,
	},
	{
		name: "Bari",
		province: "BA",
		zip: "70121",
		lat: 41.1171,
		lng: 16.8719,
	},
	{
		name: "Venezia",
		province: "VE",
		zip: "30121",
		lat: 45.4408,
		lng: 12.3155,
	},
	{
		name: "Verona",
		province: "VR",
		zip: "37121",
		lat: 45.4384,
		lng: 10.9916,
	},
	{
		name: "Padova",
		province: "PD",
		zip: "35121",
		lat: 45.4064,
		lng: 11.8768,
	},
	{
		name: "Bergamo",
		province: "BG",
		zip: "24121",
		lat: 45.6983,
		lng: 9.6773,
	},
	{
		name: "Brescia",
		province: "BS",
		zip: "25121",
		lat: 45.5416,
		lng: 10.2118,
	},
	{
		name: "Modena",
		province: "MO",
		zip: "41121",
		lat: 44.6471,
		lng: 10.9252,
	},
	{
		name: "Parma",
		province: "PR",
		zip: "43121",
		lat: 44.8015,
		lng: 11.3271,
	},
	{
		name: "Perugia",
		province: "PG",
		zip: "06121",
		lat: 43.1107,
		lng: 12.3908,
	},
	{
		name: "Trieste",
		province: "TS",
		zip: "34121",
		lat: 45.6495,
		lng: 13.7768,
	},
	{
		name: "Reggio Emilia",
		province: "RE",
		zip: "42121",
		lat: 44.6989,
		lng: 10.6297,
	},
	{
		name: "Livorno",
		province: "LI",
		zip: "57121",
		lat: 43.5485,
		lng: 10.3106,
	},
	{
		name: "Ravenna",
		province: "RA",
		zip: "48121",
		lat: 44.4184,
		lng: 12.2035,
	},
	{
		name: "Cagliari",
		province: "CA",
		zip: "09121",
		lat: 39.2238,
		lng: 9.1217,
	},
	{
		name: "Foggia",
		province: "FG",
		zip: "71121",
		lat: 41.4622,
		lng: 15.5446,
	},
	{
		name: "Rimini",
		province: "RN",
		zip: "47921",
		lat: 44.0678,
		lng: 12.5695,
	},
	{
		name: "Salerno",
		province: "SA",
		zip: "84121",
		lat: 40.6824,
		lng: 14.7681,
	},
	{
		name: "Ferrara",
		province: "FE",
		zip: "44121",
		lat: 44.8381,
		lng: 11.6198,
	},
	{
		name: "Lecce",
		province: "LE",
		zip: "73100",
		lat: 40.3516,
		lng: 18.175,
	},
	{
		name: "Trento",
		province: "TN",
		zip: "38121",
		lat: 46.0748,
		lng: 11.1217,
	},
	{
		name: "Udine",
		province: "UD",
		zip: "33100",
		lat: 46.0711,
		lng: 13.2346,
	},
	{
		name: "Ancona",
		province: "AN",
		zip: "60121",
		lat: 43.6158,
		lng: 13.5189,
	},
	{
		name: "Pisa",
		province: "PI",
		zip: "56121",
		lat: 43.7228,
		lng: 10.4017,
	},
	{
		name: "Lucca",
		province: "LU",
		zip: "55100",
		lat: 43.8429,
		lng: 10.5027,
	},
	{
		name: "Arezzo",
		province: "AR",
		zip: "52100",
		lat: 43.4631,
		lng: 11.8783,
	},
	{
		name: "Vicenza",
		province: "VI",
		zip: "36100",
		lat: 45.5455,
		lng: 11.5354,
	},
	{
		name: "Monza",
		province: "MB",
		zip: "20900",
		lat: 45.5845,
		lng: 9.2744,
	},
	{
		name: "Como",
		province: "CO",
		zip: "22100",
		lat: 45.81,
		lng: 9.0852,
	},
	{
		name: "Pavia",
		province: "PV",
		zip: "27100",
		lat: 45.1847,
		lng: 9.1582,
	},
	{
		name: "Cremona",
		province: "CR",
		zip: "26100",
		lat: 45.1332,
		lng: 10.0227,
	},
	{
		name: "Treviso",
		province: "TV",
		zip: "31100",
		lat: 45.6669,
		lng: 12.245,
	},
	{
		name: "Siracusa",
		province: "SR",
		zip: "96100",
		lat: 37.0755,
		lng: 15.2866,
	},
	{
		name: "Mantova",
		province: "MN",
		zip: "46100",
		lat: 45.1564,
		lng: 10.7914,
	},
	{
		name: "Piacenza",
		province: "PC",
		zip: "29121",
		lat: 45.0526,
		lng: 9.6929,
	},
	{
		name: "Novara",
		province: "NO",
		zip: "28100",
		lat: 45.4449,
		lng: 8.62,
	},
	{
		name: "Alessandria",
		province: "AL",
		zip: "15121",
		lat: 44.9118,
		lng: 8.6153,
	},
	{
		name: "Savona",
		province: "SV",
		zip: "17100",
		lat: 44.3091,
		lng: 8.4772,
	},
];

// ── Street names ──────────────────────────────────────────

const streets = [
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

// ── Legal forms ───────────────────────────────────────────

const legalForms = [
	"SRL",
	"SRLS",
	"SAS",
	"SNC",
	"Ditta Individuale",
	"Cooperativa",
];

// ── Business types & store names ──────────────────────────

const businessPrefixes = [
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

function makeStoreName(prefix: string, lastName: string, idx: number): string {
	const patterns = [
		`${prefix} ${lastName}`,
		`${prefix} del Centro`,
		`La Bottega di ${lastName}`,
		`${prefix} del Corso`,
		`Da ${lastName}`,
		`${prefix} di ${lastName}`,
		`Casa ${lastName}`,
		`${prefix} del Borgo`,
	];
	return patterns[idx % patterns.length];
}

const storeDescriptions = [
	"Prodotti artigianali di alta qualità dal cuore della tradizione italiana",
	"Specialità locali selezionate con cura per i nostri clienti",
	"Da tre generazioni al servizio della comunità con passione e dedizione",
	"Il meglio del territorio a portata di mano, ogni giorno",
	"Qualità, freschezza e tradizione in ogni prodotto",
	"Prodotti genuini della nostra terra, dal produttore al consumatore",
	"L'eccellenza artigianale italiana nel cuore della città",
	"Sapori autentici e ricette della tradizione",
	"Il punto di riferimento per chi cerca qualità e cortesia",
	"Passione e competenza al servizio dei nostri clienti dal 1985",
	"Selezione accurata di prodotti tipici del territorio",
	"Dove la tradizione incontra l'innovazione",
	"Prodotti freschi e genuini, scelti con cura ogni giorno",
	"Un angolo di gusto e tradizione nel centro della città",
	"La qualità che fa la differenza, da oltre vent'anni",
];

// ── Onboarding stage helpers ──────────────────────────────

const stageOrder: readonly OnboardingStatus[] = [
	"pending_email",
	"pending_personal",
	"pending_document",
	"pending_company",
	"pending_store",
	"pending_payment",
	"pending_review",
	"active",
];

function getStageIndex(status: OnboardingStatus): number {
	if (status === "rejected") return 6; // rejected = same data as pending_review
	return stageOrder.indexOf(status);
}

// ── Types ─────────────────────────────────────────────────

export interface SellerSeedData {
	email: string;
	name: string;
	onboardingStatus: OnboardingStatus;
	vatNumber: string;
	vatStatus: VatStatus;
	profileFields: {
		firstName: string | null;
		lastName: string | null;
		citizenship: string | null;
		birthCountry: string | null;
		birthDate: string | null;
		residenceCountry: string | null;
		residenceCity: string | null;
		residenceAddress: string | null;
		residenceZipCode: string | null;
		documentNumber: string | null;
		documentExpiry: string | null;
		documentIssuedMunicipality: string | null;
	};
	org: {
		businessName: string;
		legalForm: string;
		addressLine1: string;
		city: string;
		zipCode: string;
		province: string;
	};
	store: {
		name: string;
		description: string;
		addressLine1: string;
		city: string;
		zipCode: string;
		province: string;
		lat: number;
		lng: number;
	} | null;
	hasPayment: boolean;
}

// ── Status distribution (150 sellers total) ───────────────

interface StatusConfig {
	status: OnboardingStatus;
	count: number;
	vatStatus: VatStatus;
}

const statusDistribution: readonly StatusConfig[] = [
	{ status: "active", count: 55, vatStatus: "verified" },
	{ status: "pending_review", count: 25, vatStatus: "pending" },
	{ status: "pending_payment", count: 15, vatStatus: "pending" },
	{ status: "pending_store", count: 12, vatStatus: "pending" },
	{ status: "pending_company", count: 10, vatStatus: "pending" },
	{ status: "pending_document", count: 10, vatStatus: "pending" },
	{ status: "pending_personal", count: 8, vatStatus: "pending" },
	{ status: "pending_email", count: 8, vatStatus: "pending" },
	{ status: "rejected", count: 7, vatStatus: "rejected" },
];

// ── Generator ─────────────────────────────────────────────

export function generateSellersSeedData(): SellerSeedData[] {
	const sellers: SellerSeedData[] = [];
	let idx = 0;

	for (const config of statusDistribution) {
		for (let i = 0; i < config.count; i++) {
			const firstName = pick(firstNames, idx, 1);
			const lastName = pick(lastNames, idx, 3, 7);
			const residenceCity = pick(cities, idx, 2, 5);
			const orgCity = pick(cities, idx, 3, 11);
			const storeCity = pick(cities, idx, 5, 3);
			const street = pick(streets, idx, 7, 13);
			const orgStreet = pick(streets, idx, 11, 17);
			const storeStreet = pick(streets, idx, 13, 19);
			const legalForm = pick(legalForms, idx, 1, 2);
			const businessPrefix = pick(businessPrefixes, idx, 1);
			const storeDesc = pick(storeDescriptions, idx, 1, 3);

			const stage = getStageIndex(config.status);
			const streetNum = (idx % 120) + 1;
			const vatNumber = (20000000001 + idx).toString();

			// Deterministic birth date: 1960–1994
			const year = 1960 + (idx % 35);
			const month = (idx % 12) + 1;
			const day = (idx % 28) + 1;
			const birthDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

			// Document expiry: 2028–2032
			const expiryYear = 2028 + (idx % 5);
			const documentExpiry = `${expiryYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

			const hasPersonal = stage >= 2;
			const hasDocument = stage >= 3;
			const hasStore = stage >= 5;
			const hasPayment = stage >= 6;

			const businessName =
				legalForm === "Ditta Individuale"
					? `${firstName} ${lastName}`
					: legalForm === "Cooperativa"
						? `Cooperativa ${businessPrefix} ${lastName}`
						: `${businessPrefix} ${lastName}`;

			sellers.push({
				email: `seller${idx + 1}@test.com`,
				name: `${firstName} ${lastName}`,
				onboardingStatus: config.status,
				vatNumber,
				vatStatus: config.vatStatus,
				profileFields: {
					firstName: hasPersonal ? firstName : null,
					lastName: hasPersonal ? lastName : null,
					citizenship: hasPersonal ? "IT" : null,
					birthCountry: hasPersonal ? "IT" : null,
					birthDate: hasPersonal ? birthDate : null,
					residenceCountry: hasPersonal ? "IT" : null,
					residenceCity: hasPersonal ? residenceCity.name : null,
					residenceAddress: hasPersonal ? `${street}, ${streetNum}` : null,
					residenceZipCode: hasPersonal ? residenceCity.zip : null,
					documentNumber: hasDocument
						? `AX${String(idx + 1).padStart(7, "0")}`
						: null,
					documentExpiry: hasDocument ? documentExpiry : null,
					documentIssuedMunicipality: hasDocument ? residenceCity.name : null,
				},
				org: {
					businessName,
					legalForm,
					addressLine1: `${orgStreet}, ${(idx % 200) + 1}`,
					city: orgCity.name,
					zipCode: orgCity.zip,
					province: orgCity.province,
				},
				store: hasStore
					? {
							name: makeStoreName(businessPrefix, lastName, idx),
							description: storeDesc,
							addressLine1: `${storeStreet}, ${(idx % 150) + 1}`,
							city: storeCity.name,
							zipCode: storeCity.zip,
							province: storeCity.province,
							lat: storeCity.lat + (idx % 10) * 0.001,
							lng: storeCity.lng + (idx % 7) * 0.001,
						}
					: null,
				hasPayment,
			});

			idx++;
		}
	}

	return sellers;
}
