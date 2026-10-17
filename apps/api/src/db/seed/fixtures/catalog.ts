/**
 * Catalogo del seed per tipo di negozio: ogni voce dichiara il nome completo
 * del prodotto e la sua coppia macro/sotto-categoria, così una Macelleria
 * vende carne e una Ferramenta trapani. Le coppie combaciano alla lettera con
 * `data/product_categories.csv` (i nomi delle sotto-categorie si ripetono tra
 * macro, es. «Pennelli»). Solo dati: niente accesso al database.
 */

export interface CatalogEntry {
	name: string;
	macro: string;
	sub: string;
	/**
	 * Caratteristiche della sotto-categoria che il seed non valorizza: per
	 * questo oggetto non hanno senso, o il nome ne dichiara già il valore.
	 */
	skip?: readonly string[];
	/** Fascia di prezzo in euro interi, quando quella della macro non è plausibile. */
	price?: readonly [min: number, max: number];
}

const FOOD = "Alimentari e bevande";
const MODA = "Abbigliamento";
const CASA = "Casa e cucina";
const FAI_DA_TE = "Fai da te e industria";
const BELLEZZA = "Bellezza e cura personale";
const LIBRI = "Libri e media";
const UFFICIO = "Ufficio e scuola";
const GIARDINO = "Giardino e outdoor";
const SPORT = "Sport e tempo libero";
const INFANZIA = "Infanzia";
const ELETTRONICA = "Elettronica";
const ANIMALI = "Animali domestici";
const HOBBY = "Hobby e creatività";
const AUTO = "Auto e moto";

const NON_ELETTRICO = [
	"Potenza",
	"Alimentazione",
	"Tensione batteria",
	"Velocità",
];
const NON_STAGIONATO = ["Stagionatura"];
const OROLOGIO_CLASSICO = [
	"Tipo display",
	"Dimensione display",
	"Sistema operativo",
	"Compatibilità smartphone",
	"GPS",
	"Sensori",
	"Connettività",
	"Autonomia",
];
const CUSTODIA = [
	"Sistema operativo",
	"RAM",
	"Memoria interna",
	"Dimensione display",
	"Risoluzione display",
	"Fotocamera",
	"Connettività",
	"5G",
	"Dual SIM",
	"Capacità batteria",
	"Tipo connettore",
];
const TELAIO_BICI = [
	"Misura telaio",
	"Materiale telaio",
	"Diametro ruote",
	"Numero velocità",
	"Tipo freni",
	"Sospensioni",
	"Peso massimo supportato",
];
const ATTREZZO_BELLEZZA = [
	"Formato",
	"Ingredienti principali",
	"Beneficio/Funzione",
];
const NON_GIOCO_DA_TAVOLO = ["Numero giocatori", "Durata partita"];
const NON_MONTATO = ["Posizione montaggio"];
/** Su misura: la taglia standard non c'entra. */
const SU_MISURA = ["Taglia abbigliamento"];
/** Cravatte, sciarpe, foulard: niente taglia né vestibilità. */
const ACCESSORIO_TESSILE = ["Taglia abbigliamento", "Vestibilità"];

// Caratteristiche che il nome dichiara già.
const MATERIALE = ["Materiale"];
/** Legno, metallo, terracotta: il materiale fissa anche il colore. */
const MATERIALE_COLORE = ["Materiale", "Colore"];
/** Abbigliamento e pelletteria «in pelle», «in seta». */
const TESSUTO = ["Materiale", "Composizione"];
/** Lana, cashmere, tweed, lino: il tessuto dice anche la stagione. */
const TESSUTO_STAGIONE = ["Materiale", "Composizione", "Stagione"];
/** Oro, argento, perle: materiale e colore del gioiello. */
const METALLO = ["Materiale", "Composizione", "Colore"];
const VINO = ["Tipo di vino", "Vitigno", "Denominazione"];
const BIRRA = ["Tipo di birra"];
const DISTILLATO = ["Tipo di distillato"];
const CARNE = ["Tipo di carne", "Taglio"];
const SALUME = ["Tipo di carne"];
const FORMAGGIO = ["Latte"];
const PESCE = ["Specie ittica"];
/** Spumanti e frizzanti: gradazione bassa e niente annata. */
const BOLLICINE = ["Gradazione alcolica", "Annata"];
const GUSTO = ["Gusto"];
/** Pizze, fritti e panini: una porzione per pezzo. */
const PEZZO_SINGOLO = ["Porzioni"];
const FORMATO = ["Formato"];

/** Un nome, o `[nome, min, max]` per chi esce dalla fascia di prezzo della macro. */
type Prezzata = string | readonly [name: string, min: number, max: number];
type Voce = Prezzata | { voce: Prezzata; skip: readonly string[] };

/** Una voce il cui nome dichiara già queste caratteristiche. */
function dichiara(voce: Prezzata, ...skip: string[]): Voce {
	return { voce, skip };
}

/** Più voci della stessa sotto-categoria. */
function voci(
	macro: string,
	sub: string,
	names: readonly Voce[],
	skip: readonly string[] = [],
): CatalogEntry[] {
	return names.map((v) => {
		const [voce, own] =
			typeof v !== "string" && "voce" in v ? [v.voce, v.skip] : [v, []];
		const entry: CatalogEntry =
			typeof voce === "string"
				? { name: voce, macro, sub }
				: { name: voce[0], macro, sub, price: [voce[1], voce[2]] };
		const all = [...skip, ...own];
		return all.length > 0 ? { ...entry, skip: all } : entry;
	});
}

export const catalogByPrefix: Record<string, readonly CatalogEntry[]> = {
	// ── Blocco nazionale (`businessPrefixes`) ──────────────
	Alimentari: [
		...voci(FOOD, "Pasta", [
			"Spaghetti di grano duro 500 g",
			"Penne rigate 500 g",
			"Fusilli integrali 500 g",
		]),
		...voci(FOOD, "Riso", ["Riso Carnaroli 1 kg", "Riso Arborio 1 kg"]),
		...voci(FOOD, "Conserve", [
			["Passata di pomodoro 700 g", 1, 3],
			["Pomodori pelati 400 g", 1, 2],
			["Tonno all'olio d'oliva 160 g", 3, 6],
			["Ceci lessati 400 g", 1, 2],
		]),
		...voci(FOOD, "Olio e condimenti", [
			"Olio extravergine d'oliva 1 l",
			["Aceto di vino rosso 500 ml", 1, 3],
		]),
		...voci(
			FOOD,
			"Formaggi e latticini",
			[
				dichiara(
					"Parmigiano Reggiano DOP 24 mesi",
					"Stagionatura",
					"Denominazione",
				),
				dichiara("Pecorino romano DOP", "Denominazione"),
			],
			FORMAGGIO,
		),
		...voci(
			FOOD,
			"Formaggi e latticini",
			[["Mozzarella fior di latte 250 g", 2, 4]],
			[...FORMAGGIO, ...NON_STAGIONATO],
		),
		...voci(
			FOOD,
			"Salumi",
			[dichiara("Prosciutto di Parma DOP", "Denominazione")],
			SALUME,
		),
		...voci(
			FOOD,
			"Salumi",
			[dichiara("Mortadella Bologna IGP", "Denominazione")],
			[...SALUME, ...NON_STAGIONATO],
		),
		...voci(FOOD, "Snack", [
			["Taralli all'olio 250 g", 2, 4],
			["Grissini torinesi 250 g", 2, 4],
		]),
		...voci(FOOD, "Dolci", [["Frollini al burro 350 g", 2, 4]]),
		...voci(FOOD, "Caffè", [["Caffè macinato per moka 250 g", 3, 6]]),
		...voci(FOOD, "Tè", [["Tè nero classico 20 filtri", 2, 4]]),
		...voci(FOOD, "Bevande analcoliche", [
			["Acqua minerale naturale 1,5 l", 1, 2],
			["Chinotto 33 cl", 1, 3],
		]),
		...voci(FOOD, "Succhi", [["Succo di albicocca 1 l", 2, 4]]),
		...voci(FOOD, "Prodotti bio", [
			["Miele millefiori bio 500 g", 6, 10],
			["Farro perlato bio 500 g", 2, 4],
		]),
		...voci(FOOD, "Senza glutine", [
			["Fusilli di mais e riso senza glutine 400 g", 2, 4],
		]),
		...voci(
			FOOD,
			"Vino",
			[dichiara(["Lambrusco di Sorbara DOC 75 cl", 6, 12], ...BOLLICINE)],
			VINO,
		),
	],
	Panificio: [
		...voci(FOOD, "Pane e prodotti da forno", [
			"Pane casereccio 1 kg",
			"Pane toscano sciapo",
			dichiara("Pane di semola rimacinata", "Tipo di farina"),
			dichiara("Pane integrale ai cereali", "Tipo di farina"),
			dichiara("Pagnotta di segale", "Tipo di farina"),
			["Ciabatta", 1, 3],
			["Michette (4 pezzi)", 2, 3],
			["Pane al latte (6 pezzi)", 2, 4],
			"Focaccia genovese",
			"Focaccia alle olive",
			"Schiacciata all'olio",
			["Grissini stirati a mano", 3, 6],
			["Tigelle (6 pezzi)", 3, 5],
			["Piadina romagnola (4 pezzi)", 3, 6],
			dichiara(["Friselle integrali 500 g", 2, 4], "Tipo di farina"),
			["Crackers al rosmarino", 2, 4],
		]),
		...voci(FOOD, "Dolci", [
			"Crostata di albicocche",
			"Torta di mele",
			"Ciambellone",
			["Cornetto alla crema", 1, 3],
			["Brutti ma buoni 200 g", 4, 7],
			["Frollini al burro 350 g", 2, 4],
		]),
	],
	Pasticceria: [
		...voci(FOOD, "Dolci", [
			["Torta Mimosa", 18, 30],
			["Cannoli siciliani (4 pezzi)", 8, 14],
			["Sfogliatelle ricce (4 pezzi)", 6, 10],
			["Bignè alla crema 500 g", 10, 16],
			["Millefoglie alla crema", 15, 25],
			["Cassata siciliana", 20, 30],
			["Pastiera napoletana", 18, 28],
			["Torta della nonna", 15, 25],
			["Profiteroles al cioccolato", 14, 22],
			"Zuppa inglese",
			["Torta diplomatica", 16, 26],
			["Torta Sacher", 18, 28],
			["Cantucci alle mandorle 250 g", 4, 7],
			["Amaretti morbidi 200 g", 4, 7],
			["Baci di dama 200 g", 4, 7],
			["Meringhe 150 g", 3, 5],
			["Cannoncini alla crema (6 pezzi)", 5, 9],
			"Torta Paradiso",
			["Panettone artigianale 1 kg", 22, 35],
			["Colomba artigianale 1 kg", 20, 32],
			"Tiramisù",
			["Cornetto alla crema", 1, 3],
		]),
		...voci(
			FOOD,
			"Gelati",
			["Semifreddo al torroncino", "Torta gelato al cioccolato"],
			GUSTO,
		),
	],
	Macelleria: [
		...voci(
			FOOD,
			"Carne",
			[
				["Bistecca alla fiorentina", 25, 45],
				["Filetto di manzo", 20, 40],
				["Lombata di vitello", 15, 28],
				"Fesa di tacchino a fette",
				"Petto di pollo 500 g",
				"Cosce di pollo 1 kg",
				"Salsiccia di maiale 500 g",
				"Macinato di manzo 500 g",
				"Spezzatino di vitello 500 g",
				"Arista di maiale",
				"Costine di maiale",
				"Agnello a pezzi",
				"Ossobuco di vitello",
				"Scaloppine di vitello",
				["Hamburger di scottona (2 pezzi)", 4, 7],
				"Coniglio intero",
			],
			CARNE,
		),
		...voci(
			FOOD,
			"Salumi",
			[
				dichiara("Prosciutto di Parma DOP", "Denominazione"),
				dichiara("Salame Felino IGP", "Denominazione"),
				"Pancetta arrotolata",
				dichiara("Coppa piacentina DOP", "Denominazione"),
			],
			SALUME,
		),
		...voci(
			FOOD,
			"Salumi",
			[dichiara("Mortadella Bologna IGP", "Denominazione")],
			[...SALUME, ...NON_STAGIONATO],
		),
		...voci(FOOD, "Piatti pronti", [
			"Involtini di vitello",
			"Spiedini misti di carne",
			["Cotolette impanate (4 pezzi)", 6, 10],
		]),
	],
	Enoteca: [
		...voci(
			FOOD,
			"Vino",
			[
				["Barolo DOCG 75 cl", 35, 70],
				["Barbaresco DOCG 75 cl", 30, 60],
				["Brunello di Montalcino DOCG 75 cl", 40, 80],
				["Amarone della Valpolicella DOCG 75 cl", 35, 70],
				["Chianti Classico DOCG 75 cl", 12, 25],
				["Primitivo di Manduria DOC 75 cl", 9, 18],
				"Nero d'Avola Sicilia DOC 75 cl",
				dichiara(["Franciacorta Brut DOCG 75 cl", 20, 40], ...BOLLICINE),
				dichiara(
					"Prosecco Superiore di Valdobbiadene DOCG 75 cl",
					...BOLLICINE,
				),
				dichiara(["Lambrusco di Sorbara DOC 75 cl", 6, 12], ...BOLLICINE),
				"Verdicchio dei Castelli di Jesi DOC 75 cl",
				"Vermentino di Gallura DOCG 75 cl",
				"Gewürztraminer Alto Adige DOC 75 cl",
				"Montepulciano d'Abruzzo DOC 75 cl",
				dichiara("Moscato d'Asti DOCG 75 cl", ...BOLLICINE),
				["Sagrantino di Montefalco DOCG 75 cl", 20, 40],
			],
			VINO,
		),
		...voci(
			FOOD,
			"Birra",
			[
				["Birra artigianale chiara 33 cl", 3, 6],
				["Birra artigianale ambrata 33 cl", 3, 6],
				["Birra artigianale IPA 33 cl", 3, 6],
			],
			BIRRA,
		),
		...voci(
			FOOD,
			"Liquori e distillati",
			[
				dichiara("Grappa barricata 70 cl", "Gradazione alcolica"),
				dichiara("Limoncello 50 cl", "Gradazione alcolica"),
				"Amaro alle erbe 70 cl",
				"Nocino di Modena 50 cl",
				dichiara("Vermouth rosso di Torino 75 cl", "Gradazione alcolica"),
			],
			DISTILLATO,
		),
		...voci(FOOD, "Olio e condimenti", [
			dichiara("Olio extravergine toscano IGP 500 ml", "Denominazione"),
			dichiara(
				["Aceto balsamico tradizionale di Modena DOP 100 ml", 40, 80],
				"Denominazione",
			),
		]),
	],
	Ristorante: [
		...voci(FOOD, "Piatti pronti", [
			["Risotto ai funghi porcini", 10, 16],
			["Vitello tonnato", 10, 16],
			["Parmigiana di melanzane", 9, 15],
			["Lasagne alla bolognese", 9, 15],
			["Cannelloni ricotta e spinaci", 9, 14],
			["Arrosto di vitello con patate", 14, 22],
			["Insalata di mare", 12, 20],
			["Branzino al forno con patate", 16, 24],
			["Tagliata di manzo alla rucola", 16, 24],
			"Gnocchi al pesto",
			"Melanzane ripiene",
			"Carpaccio di manzo",
		]),
		...voci(FOOD, "Pasta", [
			["Tagliatelle all'uovo 250 g", 3, 5],
			["Ravioli di ricotta e spinaci 250 g", 4, 7],
		]),
		...voci(
			FOOD,
			"Vino",
			[
				["Vino rosso della casa 75 cl", 6, 12],
				["Vino bianco della casa 75 cl", 6, 12],
				["Chianti Classico DOCG 75 cl", 12, 25],
			],
			VINO,
		),
		...voci(FOOD, "Dolci", [
			"Tiramisù",
			["Panna cotta ai frutti di bosco", 4, 7],
			["Torta della nonna", 15, 25],
		]),
		...voci(FOOD, "Conserve", [["Sugo al pomodoro e basilico 300 g", 3, 6]]),
		...voci(FOOD, "Olio e condimenti", ["Olio extravergine della casa 500 ml"]),
	],
	Trattoria: [
		...voci(FOOD, "Piatti pronti", [
			["Tagliatelle al ragù", 9, 14],
			["Tortellini in brodo", 10, 15],
			["Lasagne verdi alla bolognese", 9, 15],
			["Passatelli in brodo", 9, 13],
			["Gramigna alla salsiccia", 9, 13],
			["Cotoletta alla bolognese", 14, 20],
			"Friggione",
			["Bollito misto con salsa verde", 14, 22],
			"Polpette al sugo",
			"Crescentine con salumi e squacquerone",
		]),
		...voci(FOOD, "Pasta", [
			["Tortellini fatti a mano 500 g", 14, 22],
			["Tagliatelle all'uovo 500 g", 5, 8],
			["Passatelli freschi 400 g", 5, 8],
			"Tortelloni di ricotta 500 g",
		]),
		...voci(
			FOOD,
			"Vino",
			[
				dichiara(
					"Lambrusco Grasparossa di Castelvetro DOC 75 cl",
					...BOLLICINE,
				),
				"Sangiovese di Romagna DOC 75 cl",
				dichiara("Pignoletto frizzante DOC 75 cl", ...BOLLICINE),
			],
			VINO,
		),
		...voci(FOOD, "Dolci", [
			"Zuppa inglese",
			"Torta di riso",
			["Raviole bolognesi (6 pezzi)", 4, 7],
		]),
		...voci(FOOD, "Conserve", [["Ragù bolognese in vasetto 300 g", 5, 8]]),
		...voci(FOOD, "Olio e condimenti", [
			dichiara(["Aceto balsamico di Modena IGP 250 ml", 4, 9], "Denominazione"),
		]),
	],
	Boutique: [
		...voci(MODA, "Abbigliamento donna", [
			dichiara(["Abito lungo in seta", 120, 300], ...TESSUTO),
			dichiara(
				["Blazer in lana da donna", 90, 220],
				...TESSUTO_STAGIONE,
				"Genere",
			),
			"Gonna plissettata",
			dichiara(
				["Maglione in cashmere da donna", 120, 280],
				...TESSUTO_STAGIONE,
				"Genere",
			),
			dichiara("Camicetta in viscosa", ...TESSUTO),
			dichiara(
				["Cappotto doppiopetto da donna", 180, 400],
				"Genere",
				"Stagione",
			),
			dichiara("Foulard in seta", ...ACCESSORIO_TESSILE, ...TESSUTO),
		]),
		...voci(MODA, "Abbigliamento uomo", [
			dichiara("Camicia in lino da uomo", ...TESSUTO_STAGIONE, "Genere"),
			dichiara("Pantaloni chino in cotone", ...TESSUTO),
			dichiara(["Giacca in velluto a coste", 90, 200], ...TESSUTO_STAGIONE),
			dichiara("Maglione girocollo in lana merino", ...TESSUTO_STAGIONE),
			dichiara(["Trench impermeabile da uomo", 150, 350], "Genere", "Stagione"),
			dichiara("Sciarpa in lana", ...ACCESSORIO_TESSILE, ...TESSUTO_STAGIONE),
		]),
		...voci(MODA, "Scarpe donna", [
			// La décolleté si infila: niente chiusura.
			dichiara(
				["Décolleté in pelle", 80, 200],
				"Materiale",
				"Materiale tomaia",
				"Tipo chiusura",
			),
			dichiara(
				["Stivaletti in camoscio", 90, 200],
				"Materiale",
				"Materiale tomaia",
			),
		]),
		...voci(MODA, "Scarpe uomo", [
			// Il mocassino si infila, la stringata si allaccia.
			dichiara(
				["Mocassini in pelle", 80, 180],
				"Materiale",
				"Materiale tomaia",
				"Tipo chiusura",
			),
			dichiara(
				["Stringate in pelle", 90, 220],
				"Materiale",
				"Materiale tomaia",
				"Tipo chiusura",
			),
		]),
		...voci(MODA, "Sneakers", [
			dichiara(
				["Sneakers in pelle bianche", 70, 160],
				"Materiale",
				"Materiale tomaia",
				"Colore",
			),
		]),
		...voci(MODA, "Borse", [
			dichiara(["Borsa a tracolla in pelle", 80, 250], ...TESSUTO),
			dichiara("Pochette da sera", "Taglia bagagli"),
		]),
		...voci(MODA, "Cappelli", [
			dichiara("Cappello in feltro", ...TESSUTO_STAGIONE),
		]),
		...voci(MODA, "Cinture", [
			dichiara("Cintura in pelle intrecciata", ...TESSUTO),
		]),
	],
	Gioielleria: [
		...voci(MODA, "Gioielli", [
			dichiara(["Anello solitario in oro bianco", 400, 1500], ...METALLO),
			dichiara(["Fede nuziale in oro giallo", 150, 400], ...METALLO),
			dichiara(["Collana di perle", 150, 500], ...METALLO),
			dichiara(["Orecchini a cerchio in oro", 80, 250], ...METALLO),
			dichiara(["Orecchini pendenti in argento", 30, 80], ...METALLO),
			dichiara(["Bracciale tennis in argento", 60, 150], ...METALLO),
			dichiara(["Ciondolo a cuore in oro rosa", 80, 200], ...METALLO),
			dichiara(["Catenina in oro giallo", 100, 300], ...METALLO),
			dichiara(["Anello con zaffiro", 300, 1200], "Colore"),
			dichiara(["Bracciale rigido in argento", 40, 100], ...METALLO),
			dichiara("Spilla in argento", ...METALLO),
			dichiara("Gemelli da polso in argento", ...METALLO, "Genere"),
			dichiara("Orecchini con perla", "Colore"),
			dichiara("Collana con pendente in argento", ...METALLO),
		]),
		...voci(
			MODA,
			"Orologi",
			[
				dichiara(["Orologio automatico in acciaio", 250, 900], "Materiale"),
				dichiara(
					["Orologio da donna con cinturino in pelle", 80, 300],
					"Materiale",
				),
				dichiara(["Cronografo in acciaio", 200, 800], "Materiale"),
				["Orologio da taschino", 80, 300],
				dichiara(["Orologio da immersione", 200, 800], "Resistenza acqua"),
				["Orologio al quarzo da uomo", 80, 250],
				dichiara(
					["Orologio solo tempo con cassa in oro", 1500, 5000],
					"Materiale",
					"Colore",
				),
				["Orologio gioiello da donna", 300, 1500],
			],
			OROLOGIO_CLASSICO,
		),
	],
	Libreria: [
		...voci(LIBRI, "Romanzi", [
			"I promessi sposi",
			"La coscienza di Zeno",
			"Il fu Mattia Pascal",
			"I Malavoglia",
			"Le avventure di Pinocchio",
			"Il piacere",
			"Canne al vento",
			"Piccolo mondo antico",
			"Le confessioni di un italiano",
			"Il Corsaro Nero",
			"Cuore",
			"Senilità",
		]),
		...voci(LIBRI, "Saggistica", [
			"Breve storia di Bologna",
			"Storia dell'arte italiana",
			"Il Rinascimento in dieci opere",
			"Dante e il suo tempo",
		]),
		...voci(LIBRI, "Manuali", [
			"Manuale di cucina regionale italiana",
			"Manuale di giardinaggio",
			"Guida ai sentieri dell'Appennino",
		]),
		...voci(LIBRI, "Libri scolastici", [
			"Dizionario di italiano",
			"Grammatica latina",
			"Eserciziario di matematica per le medie",
		]),
	],
	Erboristeria: [
		...voci(FOOD, "Tè", [
			"Camomilla setacciata 50 g",
			"Tisana digestiva al finocchio 20 filtri",
			"Tisana rilassante alla melissa 20 filtri",
			"Tisana depurativa al tarassaco 20 filtri",
			"Tisana ai frutti di bosco 20 filtri",
			"Tè verde biologico 100 g",
			"Infuso di rooibos 100 g",
			"Karkadè in fiori 100 g",
		]),
		...voci(FOOD, "Prodotti bio", [
			"Miele di acacia bio 500 g",
			["Gomasio bio 100 g", 3, 5],
		]),
		// Nome = principio attivo e forma (gocce, compresse, bustine).
		...voci(
			BELLEZZA,
			"Integratori",
			[
				"Propoli in gocce 30 ml",
				"Pappa reale fresca 10 g",
				"Echinacea in compresse",
				"Magnesio e potassio in bustine",
				"Valeriana in capsule",
				"Spirulina in compresse",
			],
			[...FORMATO, "Ingredienti principali"],
		),
		...voci(
			BELLEZZA,
			"Vitamine",
			["Vitamina C da acerola in compresse"],
			[...FORMATO, "Ingredienti principali"],
		),
		...voci(BELLEZZA, "Creme viso", [
			dichiara(
				"Crema viso all'aloe vera 50 ml",
				...FORMATO,
				"Ingredienti principali",
			),
			dichiara(
				"Crema alla calendula 50 ml",
				...FORMATO,
				"Ingredienti principali",
			),
			dichiara(
				"Burro di karité puro 100 ml",
				...FORMATO,
				"Ingredienti principali",
			),
		]),
		...voci(BELLEZZA, "Shampoo", [
			dichiara(["Shampoo all'ortica 250 ml", 6, 10], "Ingredienti principali"),
		]),
		...voci(BELLEZZA, "Balsamo", [
			dichiara(
				["Balsamo all'olio di argan 200 ml", 7, 12],
				"Ingredienti principali",
			),
		]),
	],
	Fiorista: [
		...voci(GIARDINO, "Fiori", [
			dichiara(["Mazzo di rose rosse (12 steli)", 25, 45], "Colore"),
			["Bouquet di tulipani", 15, 30],
			dichiara(["Mazzo di girasoli", 12, 25], "Colore"),
			["Bouquet di peonie", 25, 45],
			dichiara("Mazzo di margherite", "Colore"),
			dichiara("Ranuncoli misti", "Colore"),
			dichiara("Gerbere colorate", "Colore"),
			dichiara("Lilium bianchi", "Colore"),
			dichiara("Calle bianche", "Colore"),
			dichiara("Bouquet di fiori di campo", "Colore"),
			["Bouquet da sposa", 80, 200],
			dichiara("Mazzo di lavanda essiccata", "Colore"),
			["Composizione floreale in cesto", 35, 70],
			dichiara(["Mazzo di mimosa", 5, 10], "Colore"),
			["Rosa singola con nastro", 3, 6],
		]),
		...voci(GIARDINO, "Piante", [
			"Orchidea phalaenopsis in vaso",
			"Ortensia in vaso",
			"Pothos in vaso sospeso",
			"Sansevieria",
			["Stella di Natale", 6, 15],
		]),
		...voci(
			CASA,
			"Decorazioni casa",
			["Vaso in vetro soffiato", "Ghirlanda di fiori secchi"],
			MATERIALE,
		),
	],
	Ferramenta: [
		...voci(FAI_DA_TE, "Trapani", [
			["Trapano a percussione 800 W", 50, 120],
			["Tassellatore 900 W", 80, 200],
		]),
		...voci(FAI_DA_TE, "Avvitatori", [
			["Trapano avvitatore a batteria 18 V", 70, 180],
			["Avvitatore a impulsi 12 V", 60, 150],
			["Cacciavite elettrico ricaricabile", 20, 45],
		]),
		...voci(FAI_DA_TE, "Seghe", [
			["Seghetto alternativo 650 W", 50, 120],
			"Sega a mano per legno",
			"Seghetto per metalli",
		]),
		...voci(
			FAI_DA_TE,
			"Vernici",
			[
				"Smalto all'acqua bianco lucido 750 ml",
				"Impregnante per legno noce 2,5 l",
				["Idropittura traspirante bianca 14 l", 30, 70],
				"Antiruggine grigio 750 ml",
			],
			["Colore"],
		),
		...voci(FAI_DA_TE, "Pennelli", [
			["Pennello piatto per smalti 50 mm", 4, 9],
			["Pennellessa per pareti 100 mm", 6, 12],
			["Rullo per pareti 23 cm", 6, 12],
		]),
		...voci(FAI_DA_TE, "Materiali edilizia", [
			["Stucco in polvere 1 kg", 5, 9],
			["Silicone sigillante trasparente", 5, 10],
			["Malta rapida 5 kg", 7, 12],
			["Cemento grigio 25 kg", 6, 12],
		]),
		...voci(FAI_DA_TE, "Ferramenta", [
			// Minuteria in metallo e nylon: niente colore di fantasia.
			dichiara(["Viti per legno assortite", 5, 10], "Colore"),
			dichiara(["Tasselli in nylon (100 pezzi)", 4, 8], ...MATERIALE_COLORE),
			dichiara(["Set di chiavi a brugola", 8, 15], "Colore"),
			["Martello da carpentiere", 12, 25],
			["Metro a nastro 5 m", 5, 12],
			dichiara(["Lucchetto in ottone", 8, 18], ...MATERIALE_COLORE),
		]),
		...voci(FAI_DA_TE, "Sicurezza lavoro", [
			dichiara(["Guanti da lavoro in nitrile", 3, 8], ...MATERIALE),
			["Occhiali protettivi", 4, 10],
			["Scarpe antinfortunistiche", 40, 90],
		]),
	],
	Ceramiche: [
		...voci(CASA, "Decorazioni casa", [
			dichiara(["Vaso in ceramica di Deruta", 40, 120], ...MATERIALE),
			["Piatto decorativo da parete", 25, 70],
			dichiara(["Testa di moro in ceramica", 60, 200], ...MATERIALE),
			"Ciotola decorativa smaltata",
			dichiara(["Centrotavola in ceramica", 30, 80], ...MATERIALE),
			dichiara(["Portaombrelli in ceramica", 50, 120], ...MATERIALE),
			dichiara("Lanterna in ceramica traforata", ...MATERIALE),
			dichiara("Formella in ceramica dipinta a mano", ...MATERIALE),
			dichiara(["Pigna in ceramica di Caltagirone", 30, 90], ...MATERIALE),
			dichiara("Portafrutta in ceramica", ...MATERIALE),
		]),
		...voci(
			CASA,
			"Lampade",
			[
				["Lampada da tavolo in ceramica", 50, 140],
				["Lampada da comodino in ceramica", 40, 100],
			],
			MATERIALE,
		),
		...voci(
			CASA,
			"Pentole",
			["Tegame in terracotta", "Fagioliera in terracotta", "Pentola in coccio"],
			MATERIALE_COLORE,
		),
		...voci(
			CASA,
			"Utensili cucina",
			[
				["Oliera in ceramica", 10, 20],
				"Mortaio in ceramica con pestello",
				"Teiera in ceramica",
				["Zuccheriera in ceramica", 10, 20],
				["Tazza da colazione in ceramica", 8, 16],
				"Brocca in ceramica",
			],
			[...NON_ELETTRICO, ...MATERIALE],
		),
		...voci(
			CASA,
			"Candele",
			[["Candela in vasetto di ceramica", 12, 25]],
			MATERIALE,
		),
	],
	Pelletteria: [
		...voci(MODA, "Borse", [
			dichiara(["Borsa a mano in pelle", 120, 350], ...TESSUTO),
			dichiara(["Borsa shopper in pelle", 100, 280], ...TESSUTO),
			dichiara(["Borsa a tracolla in pelle", 80, 250], ...TESSUTO),
			dichiara(["Borsa a spalla in pelle martellata", 120, 320], ...TESSUTO),
			dichiara(["Borsa secchiello in pelle", 100, 260], ...TESSUTO),
			dichiara(["Bauletto in pelle", 120, 300], ...TESSUTO),
			dichiara(["Borsello da uomo in pelle", 50, 130], ...TESSUTO, "Genere"),
			dichiara(["Portadocumenti in pelle", 90, 220], ...TESSUTO),
			dichiara(["Cartella da lavoro in pelle", 120, 300], ...TESSUTO),
			dichiara("Marsupio in pelle", ...TESSUTO),
		]),
		...voci(MODA, "Zaini", [
			dichiara(["Zaino in pelle", 120, 300], ...TESSUTO),
			dichiara(["Zaino porta PC in pelle", 130, 320], ...TESSUTO),
			dichiara(
				["Zainetto in pelle da donna", 90, 220],
				...TESSUTO,
				"Genere",
				"Taglia bagagli",
			),
		]),
		...voci(MODA, "Valigie", [
			dichiara(
				["Borsone da viaggio in pelle", 150, 400],
				...TESSUTO,
				"Taglia bagagli",
			),
			dichiara(["Trolley da cabina", 80, 220], "Taglia bagagli"),
			dichiara("Beauty case in pelle", ...TESSUTO, "Taglia bagagli"),
			dichiara(["Valigia rigida grande", 120, 350], "Taglia bagagli"),
		]),
		...voci(MODA, "Cinture", [
			dichiara("Cintura in pelle intrecciata", ...TESSUTO),
			dichiara("Cintura in cuoio con fibbia in ottone", ...TESSUTO),
			dichiara("Cintura reversibile in pelle", ...TESSUTO),
		]),
	],
	Gelateria: [
		...voci(
			FOOD,
			"Gelati",
			[
				["Gelato al pistacchio 500 g", 11, 16],
				["Gelato alla nocciola 500 g", 10, 15],
				["Gelato alla stracciatella 500 g", 9, 14],
				["Gelato al fior di latte 500 g", 9, 14],
				["Gelato al cioccolato fondente 500 g", 9, 14],
				["Gelato alla crema 500 g", 9, 14],
				"Gelato al caffè 500 g",
				"Gelato alla fragola 500 g",
				"Gelato allo yogurt 500 g",
				"Gelato all'amarena 500 g",
				"Sorbetto al limone 500 g",
				"Sorbetto al mandarino 500 g",
				["Gelato misto 1 kg", 16, 24],
				"Semifreddo al torroncino",
				"Torta gelato al cioccolato",
				["Tartufo gelato al cioccolato", 3, 6],
				["Granita al limone", 2, 4],
				["Ghiaccioli alla frutta (4 pezzi)", 3, 6],
			],
			GUSTO,
		),
		...voci(FOOD, "Gelati", ["Cassata gelato"]),
		...voci(FOOD, "Dolci", [
			["Coni in cialda (12 pezzi)", 3, 6],
			["Brioche col tuppo (4 pezzi)", 4, 7],
			["Meringhe 150 g", 3, 5],
		]),
	],
	Pizzeria: [
		...voci(
			FOOD,
			"Piatti pronti",
			[
				["Pizza margherita", 5, 8],
				["Pizza marinara", 4, 7],
				["Pizza diavola", 6, 9],
				["Pizza capricciosa", 7, 10],
				["Pizza quattro formaggi", 7, 10],
				"Pizza prosciutto e funghi",
				"Pizza quattro stagioni",
				"Pizza bufalina",
				"Pizza ortolana",
				["Pizza napoli", 6, 9],
				["Calzone al forno", 7, 10],
				["Supplì al telefono", 2, 3],
				["Arancino al ragù", 2, 4],
				["Crocchè di patate", 1, 3],
				["Frittatina di pasta", 2, 4],
				["Olive all'ascolana", 4, 7],
				["Panzerotto fritto", 2, 4],
			],
			PEZZO_SINGOLO,
		),
		...voci(FOOD, "Dolci", ["Tiramisù", ["Babà napoletano", 3, 6]]),
		...voci(
			FOOD,
			"Vino",
			[["Gragnano della Penisola Sorrentina DOC 75 cl", 8, 13]],
			VINO,
		),
		...voci(FOOD, "Olio e condimenti", [
			["Olio piccante al peperoncino 250 ml", 4, 8],
		]),
		...voci(FOOD, "Conserve", [
			["Pomodorino del Piennolo del Vesuvio DOP 500 g", 5, 9],
		]),
	],
	Osteria: [
		...voci(FOOD, "Piatti pronti", [
			["Ribollita", 8, 12],
			["Pappa al pomodoro", 8, 12],
			["Pici all'aglione", 10, 14],
			["Peposo all'imprunetana", 14, 20],
			["Trippa alla fiorentina", 10, 15],
			"Panzanella",
			"Crostini toscani di fegatini",
			["Arista al forno con patate", 12, 18],
			["Coniglio alla cacciatora", 12, 18],
			"Fagioli all'uccelletto",
			"Polenta con funghi",
		]),
		...voci(FOOD, "Pasta", [
			["Pici freschi 500 g", 4, 7],
			["Pappardelle all'uovo 250 g", 3, 6],
		]),
		...voci(
			FOOD,
			"Vino",
			[
				["Chianti Classico DOCG 75 cl", 12, 25],
				["Rosso di Montalcino DOC 75 cl", 18, 30],
				["Vino Nobile di Montepulciano DOCG 75 cl", 15, 28],
				"Vernaccia di San Gimignano DOCG 75 cl",
			],
			VINO,
		),
		...voci(FOOD, "Dolci", [
			["Cantucci alle mandorle 250 g", 4, 7],
			"Castagnaccio",
			"Schiacciata alla fiorentina",
		]),
		...voci(FOOD, "Conserve", [["Sugo di cinghiale in vasetto 300 g", 5, 9]]),
		...voci(FOOD, "Olio e condimenti", [
			dichiara("Olio extravergine toscano IGP 500 ml", "Denominazione"),
		]),
	],
	Caffetteria: [
		...voci(FOOD, "Caffè", [
			["Caffè in grani miscela arabica 1 kg", 14, 25],
			["Caffè macinato per moka 250 g", 3, 6],
			"Caffè decaffeinato macinato 250 g",
			dichiara(
				["Cialde di caffè in carta (50 pezzi)", 9, 15],
				"Formato/Peso netto",
			),
			"Caffè d'orzo solubile 120 g",
			"Caffè al ginseng solubile 200 g",
		]),
		...voci(FOOD, "Tè", [
			"Tè verde sencha 100 g",
			"Tè Earl Grey in foglie 100 g",
			["Camomilla 20 filtri", 2, 4],
		]),
		...voci(FOOD, "Dolci", [
			["Cornetto alla crema", 1, 3],
			["Cornetto integrale al miele", 1, 3],
			["Bombolone alla crema", 1, 3],
			["Muffin al cioccolato", 2, 4],
			"Pasticcini mignon 500 g",
			["Cantucci alle mandorle 250 g", 4, 7],
		]),
		...voci(
			FOOD,
			"Piatti pronti",
			[
				["Toast prosciutto e formaggio", 3, 5],
				["Tramezzino tonno e carciofi", 2, 4],
				["Piadina crudo e squacquerone", 5, 8],
			],
			PEZZO_SINGOLO,
		),
		...voci(FOOD, "Bevande analcoliche", [
			["Tè freddo alla pesca 50 cl", 2, 4],
		]),
		...voci(FOOD, "Succhi", [
			["Spremuta d'arancia 250 ml", 3, 5],
			["Centrifugato di mela e carota 250 ml", 3, 6],
		]),
	],
	Sartoria: [
		...voci(MODA, "Abbigliamento uomo", [
			dichiara(["Abito sartoriale su misura", 800, 2500], ...SU_MISURA),
			dichiara(
				["Camicia su misura in popeline", 90, 200],
				...SU_MISURA,
				...TESSUTO,
			),
			dichiara(
				["Giacca in tweed su misura", 500, 1200],
				...SU_MISURA,
				...TESSUTO_STAGIONE,
			),
			dichiara(
				["Giacca in lino su misura", 450, 1100],
				...SU_MISURA,
				...TESSUTO_STAGIONE,
			),
			dichiara(
				["Pantaloni in flanella su misura", 200, 450],
				...SU_MISURA,
				...TESSUTO_STAGIONE,
			),
			dichiara(["Gilet in lana", 80, 180], ...TESSUTO_STAGIONE),
			dichiara(
				["Cappotto in cammello su misura", 900, 2500],
				...SU_MISURA,
				...TESSUTO_STAGIONE,
			),
			dichiara(["Smoking su misura", 1000, 2800], ...SU_MISURA),
			["Tight da cerimonia", 900, 2400],
			dichiara(
				["Cravatta in seta", 50, 120],
				...ACCESSORIO_TESSILE,
				...TESSUTO,
			),
			dichiara(["Papillon in seta", 40, 90], ...ACCESSORIO_TESSILE, ...TESSUTO),
			dichiara(
				"Pochette da taschino in seta",
				...ACCESSORIO_TESSILE,
				...TESSUTO,
			),
		]),
		...voci(MODA, "Abbigliamento donna", [
			dichiara(["Tailleur su misura", 700, 1800], ...SU_MISURA),
			dichiara(["Abito da cerimonia su misura", 800, 2200], ...SU_MISURA),
			// Il tubino è aderente, il palazzo è largo.
			dichiara(
				["Gonna a tubino su misura", 180, 400],
				...SU_MISURA,
				"Vestibilità",
			),
			dichiara(["Camicia da donna su misura", 90, 200], ...SU_MISURA, "Genere"),
			dichiara(
				["Pantaloni palazzo su misura", 200, 450],
				...SU_MISURA,
				"Vestibilità",
			),
			dichiara(
				["Cappotto da donna su misura", 900, 2400],
				...SU_MISURA,
				"Genere",
				"Stagione",
			),
			dichiara(
				["Mantella in lana su misura", 400, 1000],
				...SU_MISURA,
				...TESSUTO_STAGIONE,
			),
		]),
		...voci(MODA, "Cappelli", [
			dichiara("Coppola in tweed", ...TESSUTO_STAGIONE),
		]),
	],
	Ottica: [
		...voci(MODA, "Occhiali da sole", [
			["Occhiali da sole polarizzati", 90, 200],
			["Occhiali da sole aviator", 80, 190],
			dichiara(["Occhiali da sole rotondi in acetato", 80, 180], ...TESSUTO),
			["Occhiali da sole cat-eye", 80, 180],
			["Occhiali da sole sportivi avvolgenti", 70, 160],
			dichiara("Occhiali da sole da bambino", "Genere"),
			["Occhiali da sole pieghevoli", 80, 170],
			["Occhiali da sole con lenti specchiate", 80, 180],
			dichiara(["Occhiali da sole in titanio", 150, 320], ...TESSUTO),
			dichiara(["Occhiali da sole oversize", 80, 190], "Vestibilità"),
			["Occhiali da sole squadrati", 80, 180],
			["Occhiali da sole fotocromatici", 120, 260],
			["Occhiali da sole con lenti sfumate", 80, 180],
			dichiara(["Occhiali da sole in legno", 90, 200], ...TESSUTO, "Colore"),
			["Occhiali da sole a mascherina", 90, 200],
			"Clip da sole per occhiali da vista",
			["Occhiali da sole da guida", 90, 200],
			dichiara(
				["Occhiali da sole con montatura trasparente", 80, 180],
				"Colore",
			),
		]),
		...voci(SPORT, "Sport invernali", [
			["Maschera da sci con lente fotocromatica", 50, 140],
		]),
		...voci(SPORT, "Sport acquatici", [
			["Occhialini da nuoto graduati", 40, 90],
		]),
	],
	Profumeria: [
		...voci(BELLEZZA, "Profumi donna", [
			["Eau de parfum floreale 50 ml", 45, 90],
			["Eau de parfum orientale 100 ml", 60, 110],
			["Eau de toilette fruttata 50 ml", 30, 55],
			["Acqua profumata ai fiori bianchi 100 ml", 20, 35],
		]),
		...voci(BELLEZZA, "Profumi uomo", [
			["Eau de toilette agrumata 100 ml", 40, 70],
			["Eau de parfum legnosa 100 ml", 60, 110],
			["Acqua di colonia classica 200 ml", 20, 40],
			dichiara("Dopobarba profumato 100 ml", ...FORMATO),
		]),
		// Il nome del trucco dice la forma: fluido, compatta, matita, stick.
		...voci(
			BELLEZZA,
			"Make-up viso",
			[
				"Fondotinta fluido",
				"Cipria compatta",
				"Correttore liquido",
				dichiara("Blush in polvere", "Tonalità"),
			],
			FORMATO,
		),
		...voci(
			BELLEZZA,
			"Make-up occhi",
			[
				dichiara("Mascara volumizzante", "Effetto"),
				dichiara(["Matita occhi nera", 6, 12], "Colore", "Tonalità"),
				"Palette di ombretti",
				"Eyeliner liquido",
			],
			FORMATO,
		),
		...voci(
			BELLEZZA,
			"Make-up labbra",
			[
				dichiara("Rossetto matte", "Finish"),
				dichiara("Gloss labbra", "Finish"),
				["Matita labbra", 6, 12],
			],
			FORMATO,
		),
		...voci(
			BELLEZZA,
			"Creme viso",
			["Crema viso idratante 50 ml", "Crema antirughe notte 50 ml"],
			[...FORMATO, "Beneficio/Funzione"],
		),
		...voci(
			BELLEZZA,
			"Sieri",
			["Siero alla vitamina C 30 ml", "Siero all'acido ialuronico 30 ml"],
			[...FORMATO, "Ingredienti principali"],
		),
	],
	Cartoleria: [
		...voci(UFFICIO, "Penne", [
			["Penna stilografica", 20, 80],
			dichiara(["Penne a sfera blu (10 pezzi)", 3, 7], "Colore"),
			["Penna gel cancellabile", 1, 3],
			dichiara(["Evidenziatori (4 colori)", 3, 7], "Colore"),
		]),
		...voci(UFFICIO, "Matite", [
			dichiara(["Matite in grafite HB (12 pezzi)", 3, 7], ...MATERIALE),
			"Portamine 0,5 mm",
			["Temperamatite con serbatoio", 2, 5],
		]),
		...voci(UFFICIO, "Quaderni", [
			["Quaderno A4 a righe", 2, 4],
			["Quaderno A4 a quadretti", 2, 4],
			"Quaderno ad anelli",
			"Taccuino con copertina rigida",
			["Album da disegno A4", 4, 8],
		]),
		...voci(UFFICIO, "Agende", [
			"Agenda settimanale con copertina rigida",
			"Planner mensile da tavolo",
		]),
		...voci(UFFICIO, "Organizer", [
			["Raccoglitore ad anelli", 3, 7],
			"Astuccio a tre zip",
			["Portalistini 40 buste", 3, 7],
			["Cartellina con elastico", 2, 4],
		]),
		...voci(UFFICIO, "Zaini scuola", [
			["Zaino scuola ergonomico", 40, 90],
			["Zaino trolley per la scuola", 50, 110],
		]),
		...voci(HOBBY, "Colori", [
			"Pastelli colorati (24 pezzi)",
			["Pennarelli lavabili (12 pezzi)", 4, 9],
			"Acquerelli in pastiglie (12 colori)",
		]),
	],
	Vivaio: [
		...voci(GIARDINO, "Piante", [
			["Ulivo in vaso", 25, 80],
			["Limone in vaso", 20, 50],
			"Rosmarino in vaso",
			"Lavanda in vaso",
			["Basilico in vaso", 2, 4],
			["Fragole in vaso", 3, 6],
			"Gelsomino rampicante",
			"Glicine in vaso",
			"Bosso sempreverde",
			"Rosa rampicante",
			["Acero giapponese", 30, 90],
			"Ortensia in vaso",
			["Piantine di pomodoro (6 pezzi)", 3, 6],
		]),
		...voci(GIARDINO, "Semi", [
			["Semi di zucchina", 2, 4],
			["Semi di basilico", 2, 4],
			"Miscuglio per prato 1 kg",
			["Bulbi di tulipano (10 pezzi)", 5, 10],
		]),
		...voci(GIARDINO, "Attrezzi giardino", [
			"Forbici da potatura",
			dichiara("Rastrello in acciaio", ...MATERIALE_COLORE),
			dichiara("Vanga con manico in legno", ...MATERIALE),
			["Guanti da giardinaggio", 5, 12],
			["Tagliasiepi elettrico", 60, 150],
		]),
		...voci(GIARDINO, "Irrigazione", [
			"Tubo da giardino 25 m",
			"Irrigatore oscillante",
			dichiara("Annaffiatoio in metallo 10 l", ...MATERIALE),
			"Programmatore per irrigazione",
		]),
	],
	Gastronomia: [
		...voci(FOOD, "Piatti pronti", [
			["Lasagne alla bolognese", 9, 15],
			["Vitello tonnato", 10, 16],
			["Parmigiana di melanzane", 9, 15],
			"Insalata russa",
			"Insalata di riso",
			"Polpettone farcito",
			"Arancini di riso (4 pezzi)",
			"Peperoni ripieni",
			"Torta salata ricotta e spinaci",
			"Pollo arrosto",
		]),
		...voci(FOOD, "Pasta", [
			["Tortellini di Bologna 500 g", 14, 22],
			"Tortelloni di ricotta 500 g",
		]),
		...voci(
			FOOD,
			"Salumi",
			[
				dichiara("Prosciutto di Parma DOP", "Denominazione"),
				dichiara("Culatello di Zibello DOP", "Denominazione"),
				dichiara("Salame Felino IGP", "Denominazione"),
			],
			SALUME,
		),
		...voci(
			FOOD,
			"Salumi",
			[dichiara("Mortadella Bologna IGP", "Denominazione")],
			[...SALUME, ...NON_STAGIONATO],
		),
		...voci(
			FOOD,
			"Formaggi e latticini",
			[
				dichiara(
					"Parmigiano Reggiano DOP 24 mesi",
					"Stagionatura",
					"Denominazione",
				),
				// Dolce = giovane, pochi mesi.
				dichiara("Gorgonzola dolce DOP", "Stagionatura", "Denominazione"),
			],
			FORMAGGIO,
		),
		...voci(
			FOOD,
			"Formaggi e latticini",
			[
				dichiara(["Squacquerone di Romagna DOP", 3, 6], "Denominazione"),
				["Ricotta di pecora", 3, 6],
			],
			[...FORMAGGIO, ...NON_STAGIONATO],
		),
		...voci(FOOD, "Conserve", [
			["Carciofini sott'olio 280 g", 4, 7],
			"Funghi porcini secchi 50 g",
		]),
		...voci(FOOD, "Olio e condimenti", [
			dichiara(["Aceto balsamico di Modena IGP 250 ml", 4, 9], "Denominazione"),
		]),
	],

	// ── Blocco bolognese (`bolognaPrefixes`) ──────────────
	Pescheria: [
		...voci(
			FOOD,
			"Pesce",
			[
				["Orata", 10, 18],
				["Branzino", 12, 20],
				["Salmone in tranci", 12, 22],
				["Gamberi rossi", 25, 45],
				["Calamari", 12, 20],
				["Cozze 1 kg", 3, 6],
				"Vongole veraci 500 g",
				["Seppie", 10, 16],
				["Polpo", 14, 22],
				["Pesce spada in tranci", 18, 28],
				["Alici fresche", 5, 9],
				["Sogliola", 18, 28],
				"Merluzzo in filetti",
				"Baccalà ammollato",
				["Tonno rosso in tranci", 25, 40],
				["Scampi", 25, 45],
			],
			PESCE,
		),
		...voci(FOOD, "Piatti pronti", [
			["Insalata di mare", 12, 20],
			"Frittura di paranza",
			"Baccalà mantecato",
			["Alici marinate", 6, 10],
		]),
		...voci(FOOD, "Conserve", [
			["Filetti di alici sott'olio 80 g", 3, 6],
			"Bottarga di muggine grattugiata 80 g",
			["Sgombro sott'olio 200 g", 3, 6],
		]),
	],
	Bar: [
		...voci(FOOD, "Caffè", [
			["Caffè in grani miscela arabica 1 kg", 14, 25],
			["Caffè macinato per moka 250 g", 3, 6],
		]),
		...voci(FOOD, "Snack", [
			["Patatine classiche 150 g", 1, 3],
			["Arachidi tostate salate 200 g", 2, 4],
			["Taralli all'olio 250 g", 2, 4],
		]),
		...voci(
			FOOD,
			"Birra",
			[
				["Birra lager in bottiglia 66 cl", 1, 3],
				["Birra artigianale chiara 33 cl", 3, 6],
				["Birra rossa doppio malto 33 cl", 2, 4],
				["Birra weiss 50 cl", 2, 4],
			],
			BIRRA,
		),
		...voci(
			FOOD,
			"Vino",
			[
				dichiara("Pignoletto frizzante DOC 75 cl", ...BOLLICINE),
				dichiara("Prosecco DOC extra dry 75 cl", ...BOLLICINE),
			],
			VINO,
		),
		// Grappa, limoncello e bitter hanno gradazioni loro (grappa ≥ 37,5%).
		...voci(
			FOOD,
			"Liquori e distillati",
			[
				"Amaro alle erbe 70 cl",
				dichiara("Limoncello 50 cl", "Gradazione alcolica"),
				dichiara("Bitter rosso per aperitivo 70 cl", "Gradazione alcolica"),
				dichiara("Grappa bianca 70 cl", "Gradazione alcolica"),
			],
			DISTILLATO,
		),
		...voci(FOOD, "Bevande analcoliche", [
			["Chinotto 33 cl", 1, 3],
			["Acqua tonica 20 cl", 1, 2],
			["Tè freddo alla pesca 50 cl", 2, 4],
		]),
		...voci(
			FOOD,
			"Piatti pronti",
			[
				["Piadina crudo e squacquerone", 5, 8],
				["Toast prosciutto e formaggio", 3, 5],
				["Tramezzino tonno e carciofi", 2, 4],
			],
			PEZZO_SINGOLO,
		),
		...voci(FOOD, "Dolci", [["Cornetto alla crema", 1, 3]]),
	],
	Parrucchiere: [
		...voci(BELLEZZA, "Shampoo", [
			dichiara(
				"Shampoo nutriente per capelli secchi 250 ml",
				"Tipo pelle/capelli",
				"Beneficio/Funzione",
			),
			dichiara("Shampoo antiforfora 250 ml", "Beneficio/Funzione"),
			dichiara("Shampoo per capelli colorati 250 ml", "Tipo pelle/capelli"),
			"Shampoo delicato per uso frequente 250 ml",
			dichiara("Shampoo ristrutturante 1 l", "Beneficio/Funzione"),
			// Si spruzza sui capelli asciutti, senz'acqua.
			dichiara("Shampoo secco 200 ml", ...FORMATO, "Modalità d'uso"),
		]),
		...voci(BELLEZZA, "Balsamo", [
			dichiara("Balsamo districante 200 ml", "Beneficio/Funzione"),
			dichiara(
				"Maschera per capelli alla cheratina 250 ml",
				...FORMATO,
				"Ingredienti principali",
			),
			dichiara("Balsamo senza risciacquo 150 ml", "Modalità d'uso"),
			dichiara("Balsamo per capelli ricci 200 ml", "Tipo pelle/capelli"),
		]),
		// Lacca, mousse, cera, gel: il nome è già il formato.
		...voci(
			BELLEZZA,
			"Styling capelli",
			[
				"Lacca a tenuta forte 400 ml",
				dichiara("Mousse volumizzante 200 ml", "Beneficio/Funzione"),
				"Cera opaca 100 ml",
				dichiara("Spray termoprotettore 150 ml", "Beneficio/Funzione"),
				"Gel fissante 150 ml",
				dichiara("Olio per punte secche 50 ml", "Tipo pelle/capelli"),
				dichiara("Crema per ricci 150 ml", "Tipo pelle/capelli"),
			],
			FORMATO,
		),
		...voci(
			BELLEZZA,
			"Styling capelli",
			[
				["Asciugacapelli professionale 2000 W", 60, 150],
				dichiara(["Piastra per capelli in ceramica", 40, 120], ...MATERIALE),
				["Ferro arricciacapelli", 30, 80],
			],
			ATTREZZO_BELLEZZA,
		),
	],
	Barbiere: [
		...voci(BELLEZZA, "Shampoo", [
			dichiara("Shampoo da uomo rinforzante 250 ml", "Beneficio/Funzione"),
			// La barba non è un tipo di capello.
			dichiara(
				"Shampoo per barba 150 ml",
				"Tipo pelle/capelli",
				"Modalità d'uso",
			),
		]),
		...voci(
			BELLEZZA,
			"Styling capelli",
			[
				"Cera opaca 100 ml",
				"Gel fissante 150 ml",
				"Pomata lucida per capelli 100 ml",
				"Tonico per capelli 200 ml",
			],
			FORMATO,
		),
		...voci(
			BELLEZZA,
			"Styling capelli",
			[
				dichiara("Pettine in corno", ...MATERIALE),
				dichiara(
					"Spazzola per barba in setola",
					...MATERIALE,
					"Tipo pelle/capelli",
				),
			],
			ATTREZZO_BELLEZZA,
		),
		...voci(
			BELLEZZA,
			"Rasoi elettrici",
			[
				["Regolabarba ricaricabile", 30, 70],
				["Rasoio elettrico a lamina", 60, 150],
				["Tagliacapelli con pettini", 30, 80],
				"Rifinitore per naso e orecchie",
			],
			ATTREZZO_BELLEZZA,
		),
		...voci(BELLEZZA, "Creme viso", [
			"Balsamo dopobarba 100 ml",
			dichiara("Olio da barba 30 ml", ...FORMATO),
			dichiara("Crema da barba 150 ml", ...FORMATO),
			"Balsamo per barba 50 ml",
			dichiara(
				"Crema idratante viso da uomo 50 ml",
				...FORMATO,
				"Beneficio/Funzione",
			),
		]),
		...voci(BELLEZZA, "Profumi uomo", [
			["Eau de toilette agrumata 100 ml", 40, 70],
			["Eau de parfum legnosa 100 ml", 60, 110],
			["Acqua di colonia classica 200 ml", 20, 40],
		]),
	],
	Fumetteria: [
		...voci(LIBRI, "Fumetti", [
			"Graphic novel noir",
			"Raccolta di strisce umoristiche",
			"Albo di fantascienza a colori",
			["Manga d'avventura volume 1", 5, 8],
			["Manga d'avventura volume 2", 5, 8],
			["Cofanetto manga volumi 1–5", 25, 40],
			["Manga sentimentale volume 1", 5, 8],
			"Fumetto western in bianco e nero",
			"Fumetto horror a colori",
			"Antologia del fumetto italiano",
			"Graphic novel storica",
			"Albo variant da collezione",
			"Volume integrale di fumetto d'avventura",
			"Graphic novel autobiografica",
			["Fanzine autoprodotta", 3, 8],
		]),
		...voci(LIBRI, "Blu-ray", ["Serie animata in cofanetto Blu-ray"]),
		...voci(LIBRI, "DVD", [["Film d'animazione in DVD", 7, 15]]),
		...voci(HOBBY, "Modellismo", [
			"Kit di montaggio robot in scala 1:144",
			dichiara("Miniature fantasy da dipingere", "Colore"),
			"Modellino di astronave da montare",
		]),
		...voci(HOBBY, "Colori", ["Colori acrilici per miniature (set)"]),
	],
	Biciclette: [
		...voci(SPORT, "Biciclette", [
			dichiara(["City bike da donna 28 pollici", 250, 600], "Diametro ruote"),
			dichiara(["City bike da uomo 28 pollici", 250, 600], "Diametro ruote"),
			dichiara(
				["Mountain bike front 29 pollici", 400, 1200],
				"Diametro ruote",
				"Sospensioni",
			),
			// Corsa e gravel: telaio rigido.
			dichiara(
				["Bici da corsa in alluminio", 700, 1800],
				"Materiale",
				"Materiale telaio",
				"Sospensioni",
			),
			dichiara(["Bici gravel", 800, 2000], "Sospensioni"),
			["Bici da trekking", 500, 1200],
			// Taglia unica.
			dichiara(
				["Bici pieghevole 20 pollici", 300, 800],
				"Diametro ruote",
				"Misura telaio",
			),
			["Bici elettrica da città", 1200, 3000],
			// Misure da adulto: non valgono per le bici dei bambini.
			dichiara(["Bicicletta da bambino 16 pollici", 120, 300], ...TELAIO_BICI),
			dichiara(["Bici senza pedali", 40, 120], ...TELAIO_BICI),
		]),
		// Misure del telaio e portata da bici: sugli accessori non valgono.
		...voci(
			SPORT,
			"Accessori bici",
			[
				["Casco da bici", 30, 120],
				"Luci LED per bici (coppia)",
				"Lucchetto ad arco",
				dichiara(["Campanello in ottone", 5, 15], ...MATERIALE_COLORE),
				"Pompa da pavimento con manometro",
				["Borraccia da bici 750 ml", 5, 15],
				dichiara("Sella in gel", ...MATERIALE),
				["Cavalletto laterale", 10, 25],
				"Parafanghi (coppia)",
				dichiara(["Camera d'aria 700x28c", 5, 12], "Colore"),
				dichiara("Copertone da città 700x35c", "Colore"),
				"Portapacchi posteriore",
				["Seggiolino posteriore per bambini", 50, 130],
			],
			TELAIO_BICI,
		),
	],
	"Articoli sportivi": [
		...voci(SPORT, "Attrezzi palestra", [
			"Corda per saltare",
			"Elastici di resistenza (set)",
			["Panca piana pieghevole", 60, 150],
			"Ruota per addominali",
		]),
		...voci(SPORT, "Pesi", [
			["Manubri esagonali 2 × 5 kg", 25, 50],
			["Kettlebell 12 kg", 25, 50],
			["Bilanciere con dischi 20 kg", 50, 120],
			"Cavigliere zavorrate 2 × 1 kg",
		]),
		...voci(SPORT, "Yoga", [
			"Tappetino yoga antiscivolo",
			dichiara(["Blocco yoga in sughero", 8, 18], ...MATERIALE_COLORE),
			["Cinghia per yoga", 6, 15],
		]),
		...voci(SPORT, "Pilates", ["Palla da pilates 65 cm", "Anello pilates"]),
		...voci(SPORT, "Camping", [
			["Tenda da campeggio 3 posti", 60, 200],
			["Sacco a pelo", 40, 120],
			"Lampada frontale",
			["Materassino autogonfiante", 40, 100],
		]),
		...voci(SPORT, "Escursionismo", [
			["Zaino da trekking 40 l", 60, 150],
			"Bastoncini da trekking",
			"Borraccia termica 500 ml",
		]),
		...voci(SPORT, "Sport acquatici", [
			["Occhialini da nuoto", 8, 25],
			dichiara(["Cuffia in silicone", 5, 15], ...MATERIALE),
		]),
		...voci(SPORT, "Sport invernali", [
			["Maschera da sci con lente fotocromatica", 50, 140],
			"Guanti da sci",
		]),
		...voci(MODA, "Sneakers", [["Scarpe da running", 80, 160]]),
	],
	Giocattoli: [
		...voci(
			INFANZIA,
			"Giocattoli educativi",
			[
				dichiara("Puzzle in legno 24 pezzi", ...MATERIALE),
				dichiara("Abaco in legno", ...MATERIALE),
				["Kit del piccolo chimico", 20, 40],
				["Telescopio per bambini", 30, 70],
				["Lavagna magnetica", 15, 35],
				["Mappamondo luminoso", 20, 45],
			],
			NON_GIOCO_DA_TAVOLO,
		),
		...voci(INFANZIA, "Giocattoli educativi", [
			"Memory degli animali",
			["Gioco da tavolo per famiglie", 20, 45],
			"Tombola tradizionale",
		]),
		...voci(INFANZIA, "Peluche", [
			"Orsetto di peluche",
			"Peluche coniglio",
			"Peluche dinosauro",
			"Peluche gatto",
		]),
		...voci(INFANZIA, "Costruzioni", [
			["Mattoncini da costruzione 500 pezzi", 20, 45],
			["Costruzioni magnetiche", 25, 60],
			dichiara(["Trenino in legno con binari", 25, 60], ...MATERIALE),
			dichiara("Costruzioni in legno", ...MATERIALE),
		]),
		...voci(HOBBY, "Modellismo", [
			"Modellino d'auto da montare in scala 1:24",
			dichiara("Aeromodello in balsa", ...MATERIALE_COLORE),
		]),
		...voci(HOBBY, "Kit fai da te", [
			"Kit braccialetti con perline",
			"Kit di pasta modellabile",
			"Kit per dipingere i sassi",
		]),
	],
	Elettronica: [
		...voci(ELETTRONICA, "Smartphone", [
			dichiara(
				["Smartphone Android 128 GB", 150, 400],
				"Sistema operativo",
				"Memoria interna",
			),
		]),
		...voci(ELETTRONICA, "Tablet", [
			dichiara(
				["Tablet 10 pollici 64 GB", 150, 350],
				"Dimensione display",
				"Memoria interna",
			),
		]),
		...voci(ELETTRONICA, "Laptop", [
			dichiara(
				["Notebook 15,6 pollici 512 GB", 450, 1000],
				"Dimensione display",
				"Memoria/Storage",
			),
		]),
		...voci(ELETTRONICA, "Monitor", [
			// QHD = 2560 × 1440, 16:9.
			dichiara(
				["Monitor 27 pollici QHD", 200, 400],
				"Dimensione display",
				"Risoluzione",
				"Formato schermo",
			),
		]),
		...voci(ELETTRONICA, "Mouse", [
			dichiara("Mouse wireless ergonomico", "Connessione", "Wireless"),
		]),
		...voci(ELETTRONICA, "Tastiere", [
			dichiara(
				["Tastiera meccanica retroilluminata", 50, 130],
				"Tipo tasti/switch",
				"Retroilluminazione",
			),
		]),
		...voci(ELETTRONICA, "Webcam", [
			dichiara(
				["Webcam Full HD con microfono", 30, 80],
				"Risoluzione video",
				"Microfono integrato",
			),
		]),
		...voci(ELETTRONICA, "Cuffie", [
			dichiara(
				["Cuffie wireless con cancellazione del rumore", 100, 300],
				"Connessione",
				"Cancellazione rumore",
			),
			dichiara(["Cuffie da gaming con microfono", 40, 120], "Microfono"),
		]),
		...voci(ELETTRONICA, "Auricolari", [
			dichiara(["Auricolari true wireless", 40, 150], "Connessione"),
		]),
		...voci(ELETTRONICA, "Speaker Bluetooth", [
			dichiara(["Speaker Bluetooth impermeabile", 40, 120], "Connessione"),
		]),
		...voci(ELETTRONICA, "Smart TV", [
			dichiara(
				["Smart TV 55 pollici 4K", 400, 900],
				"Dimensione schermo",
				"Risoluzione",
				"Smart TV",
			),
		]),
		...voci(ELETTRONICA, "Console", [["Console portatile", 200, 400]]),
		...voci(
			ELETTRONICA,
			"Videogiochi",
			[
				["Videogioco di corse automobilistiche", 30, 70],
				["Videogioco d'avventura", 30, 70],
			],
			[
				"Alimentazione",
				"Potenza",
				"Modello",
				"Colore",
				"Materiale",
				"Connettività",
			],
		),
		...voci(
			ELETTRONICA,
			"Accessori console",
			[["Controller wireless per console", 40, 75]],
			["Potenza"],
		),
		...voci(ELETTRONICA, "Smartwatch", [
			dichiara(["Smartwatch con GPS", 150, 400], "GPS"),
		]),
		...voci(ELETTRONICA, "Fitness tracker", [
			dichiara(
				["Braccialetto fitness con cardiofrequenzimetro", 30, 80],
				"Sensori",
			),
		]),
		...voci(ELETTRONICA, "eReader", [
			dichiara(["eReader 6 pollici", 100, 200], "Dimensione display"),
		]),
		...voci(ELETTRONICA, "Power bank", [
			dichiara("Power bank 20.000 mAh", "Capacità batteria"),
		]),
		...voci(ELETTRONICA, "Caricabatterie", [
			dichiara(
				"Caricatore USB-C 65 W",
				"Potenza",
				"Tipo connettore",
				"Ricarica rapida",
			),
		]),
		...voci(ELETTRONICA, "Domotica", [
			["Lampadina smart Wi-Fi E27", 8, 20],
			["Presa smart Wi-Fi", 10, 25],
		]),
		...voci(ELETTRONICA, "Sicurezza smart", [
			["Videocamera di sorveglianza Wi-Fi", 30, 80],
		]),
		...voci(ELETTRONICA, "Action cam", [
			["Action cam 4K impermeabile", 100, 350],
		]),
		...voci(ELETTRONICA, "Droni", [["Drone con videocamera 4K", 200, 700]]),
	],
	Telefonia: [
		...voci(ELETTRONICA, "Smartphone", [
			dichiara(
				["Smartphone Android 128 GB", 150, 400],
				"Sistema operativo",
				"Memoria interna",
			),
			dichiara(
				["Smartphone Android 256 GB", 250, 600],
				"Sistema operativo",
				"Memoria interna",
			),
			dichiara(
				["Smartphone compatto 5G 128 GB", 200, 500],
				"5G",
				"Memoria interna",
			),
			dichiara(["Smartphone rinforzato 64 GB", 150, 350], "Memoria interna"),
		]),
		...voci(
			ELETTRONICA,
			"Custodie smartphone",
			[
				dichiara("Custodia in silicone", ...MATERIALE),
				dichiara("Custodia a libro in ecopelle", ...MATERIALE),
				dichiara("Cover trasparente antiurto", "Colore", "Protezione"),
			],
			CUSTODIA,
		),
		...voci(
			ELETTRONICA,
			"Custodie smartphone",
			[dichiara("Pellicola protettiva in vetro temperato", ...MATERIALE)],
			[...CUSTODIA, "Tipo chiusura"],
		),
		...voci(ELETTRONICA, "Caricabatterie", [
			// USB-C con i watt nel nome: ricarica rapida (Power Delivery).
			dichiara(
				"Caricatore USB-C 65 W",
				"Potenza",
				"Tipo connettore",
				"Ricarica rapida",
			),
			dichiara(
				"Caricatore USB-C 20 W",
				"Potenza",
				"Tipo connettore",
				"Ricarica rapida",
			),
			dichiara("Caricatore wireless 15 W", "Potenza", "Numero porte"),
			// Presa accendisigari a 12 V, due uscite USB-A.
			dichiara(
				"Caricatore da auto con doppia USB",
				"Tensione ingresso",
				"Numero porte",
				"Tipo connettore",
			),
		]),
		...voci(ELETTRONICA, "Power bank", [
			dichiara("Power bank 20.000 mAh", "Capacità batteria"),
			dichiara("Power bank magnetico 5.000 mAh", "Capacità batteria"),
		]),
		...voci(ELETTRONICA, "Auricolari", [
			dichiara(["Auricolari true wireless", 40, 150], "Connessione"),
			"Auricolari sportivi con archetto",
		]),
		...voci(ELETTRONICA, "Cuffie", [
			dichiara("Cuffie Bluetooth pieghevoli", "Connessione"),
		]),
		...voci(ELETTRONICA, "Smartwatch", [
			dichiara(["Smartwatch con GPS", 150, 400], "GPS"),
			["Smartwatch con chiamate Bluetooth", 60, 200],
		]),
		...voci(ELETTRONICA, "Tablet", [
			dichiara(
				["Tablet 10 pollici 64 GB", 150, 350],
				"Dimensione display",
				"Memoria interna",
			),
			dichiara(
				["Tablet 8 pollici 32 GB", 100, 200],
				"Dimensione display",
				"Memoria interna",
			),
		]),
		...voci(ELETTRONICA, "Fitness tracker", [
			dichiara(
				["Braccialetto fitness con cardiofrequenzimetro", 30, 80],
				"Sensori",
			),
		]),
	],
	Copisteria: [
		...voci(UFFICIO, "Cartucce", [
			dichiara(["Cartuccia d'inchiostro nero compatibile", 8, 20], "Colore"),
			dichiara(["Cartucce a colori (confezione da 3)", 15, 35], "Colore"),
			dichiara(["Toner nero per stampante laser", 25, 70], "Colore"),
			["Kit di ricarica inchiostro", 10, 20],
		]),
		...voci(UFFICIO, "Stampanti", [
			// Multifunzione = con scanner.
			dichiara(
				["Stampante multifunzione a getto d'inchiostro", 60, 180],
				"Tecnologia di stampa",
				"Scanner integrato",
			),
			dichiara(
				["Stampante laser monocromatica", 90, 220],
				"Tecnologia di stampa",
				"Colore/Monocromatica",
			),
		]),
		...voci(UFFICIO, "Organizer", [
			["Raccoglitore ad anelli", 3, 7],
			["Cartellina con elastico", 2, 4],
			["Portalistini 40 buste", 3, 7],
			dichiara(["Buste trasparenti forate (100 pezzi)", 4, 9], "Colore"),
			"Copertine per rilegatura (100 pezzi)",
			"Etichette adesive A4 (100 fogli)",
		]),
		...voci(UFFICIO, "Quaderni", [
			["Blocco notes A4 a quadretti", 2, 5],
			["Quaderno A4 a righe", 2, 4],
		]),
		...voci(UFFICIO, "Penne", [
			dichiara(["Penne a sfera blu (10 pezzi)", 3, 7], "Colore"),
			dichiara(["Evidenziatori (4 colori)", 3, 7], "Colore"),
			dichiara(["Marcatore indelebile nero", 1, 4], "Colore"),
			dichiara(["Penna roller nera", 2, 5], "Colore"),
		]),
		...voci(UFFICIO, "Agende", ["Agenda settimanale con copertina rigida"]),
		...voci(UFFICIO, "Matite", [
			dichiara(["Matite in grafite HB (12 pezzi)", 3, 7], ...MATERIALE),
		]),
	],
	"Pet shop": [
		...voci(
			ANIMALI,
			"Cibo cani",
			[
				dichiara(["Crocchette per cani adulti 3 kg", 12, 25], "Età animale"),
				dichiara(["Crocchette per cuccioli 1,5 kg", 9, 18], "Età animale"),
				dichiara(
					["Bocconcini per cani al manzo 400 g", 1, 3],
					"Gusto/Proteina",
				),
			],
			["Specie"],
		),
		...voci(
			ANIMALI,
			"Cibo gatti",
			[
				dichiara(
					["Crocchette per gatti sterilizzati 1,5 kg", 9, 18],
					"Esigenza specifica",
					"Età animale",
				),
				dichiara(
					["Bocconcini per gatti al salmone 85 g", 1, 2],
					"Gusto/Proteina",
				),
				dichiara(["Paté per gatti al pollo 100 g", 1, 3], "Gusto/Proteina"),
			],
			["Specie"],
		),
		...voci(ANIMALI, "Snack animali", [
			"Snack dentali per cani",
			"Biscotti per cani 500 g",
			["Snack cremosi per gatti", 2, 5],
		]),
		...voci(ANIMALI, "Cucce", [
			dichiara(["Cuccia in tessuto imbottita", 20, 50], ...MATERIALE),
			["Cuscino per cani lavabile", 15, 40],
			["Casetta per gatti", 20, 50],
		]),
		...voci(ANIMALI, "Trasportini", [
			["Trasportino rigido per gatti", 20, 45],
			["Borsa trasportino per cani piccoli", 20, 45],
		]),
		...voci(ANIMALI, "Guinzagli", [
			dichiara(["Guinzaglio in nylon", 6, 14], ...MATERIALE),
			["Guinzaglio allungabile 5 m", 12, 28],
		]),
		...voci(ANIMALI, "Collari", [
			dichiara("Collare in pelle per cani", ...MATERIALE),
			["Collare per gatti con campanello", 4, 10],
			"Pettorina regolabile",
		]),
		...voci(ANIMALI, "Giochi animali", [
			["Tiragraffi a colonna", 25, 80],
			dichiara(["Pallina per cani in gomma", 2, 6], ...MATERIALE),
			["Canna con piume per gatti", 3, 8],
		]),
		...voci(ANIMALI, "Prodotti igiene", [
			["Lettiera vegetale agglomerante 10 l", 5, 10],
			["Shampoo per cani 250 ml", 5, 12],
			["Spazzola per pelo", 6, 15],
			["Sacchetti igienici (120 pezzi)", 2, 6],
		]),
	],
	Parafarmacia: [
		...voci(
			BELLEZZA,
			"Integratori",
			[
				"Fermenti lattici in flaconcini",
				"Magnesio e potassio in bustine",
				"Omega 3 in perle",
				["Collagene in polvere", 20, 35],
			],
			[...FORMATO, "Ingredienti principali"],
		),
		...voci(BELLEZZA, "Integratori", [
			dichiara("Integratore di ferro", "Ingredienti principali"),
		]),
		...voci(
			BELLEZZA,
			"Vitamine",
			[
				"Vitamina D3 in gocce",
				"Multivitaminico in compresse",
				"Vitamina C effervescente",
			],
			[...FORMATO, "Ingredienti principali"],
		),
		...voci(
			BELLEZZA,
			"Creme viso",
			[
				"Crema solare viso SPF 50",
				dichiara(
					"Crema idratante per pelli sensibili 50 ml",
					"Beneficio/Funzione",
					"Tipo pelle/capelli",
				),
				dichiara(
					"Crema riparatrice per pelli secche 50 ml",
					"Beneficio/Funzione",
					"Tipo pelle/capelli",
				),
			],
			FORMATO,
		),
		...voci(BELLEZZA, "Shampoo", ["Shampoo dermatologico delicato 200 ml"]),
		...voci(INFANZIA, "Prodotti allattamento", [
			"Biberon anticolica 260 ml",
			"Tiralatte manuale",
			dichiara(["Ciuccio in silicone 0–6 mesi", 4, 9], ...MATERIALE),
			["Coppette assorbilatte (30 pezzi)", 5, 9],
		]),
		// Taglia, fascia di peso e pezzi stanno tutti nel nome.
		...voci(
			INFANZIA,
			"Pannolini",
			[
				"Pannolini taglia 3 (30 pezzi)",
				"Pannolini taglia 4 (28 pezzi)",
				"Mutandine assorbenti taglia 5 (20 pezzi)",
			],
			["Taglia pannolini", "Peso bambino", "Numero pezzi"],
		),
		...voci(FOOD, "Senza glutine", [
			["Biscotti senza glutine 250 g", 3, 5],
			["Pane in cassetta senza glutine 300 g", 3, 5],
			["Fusilli di mais e riso senza glutine 400 g", 2, 4],
		]),
	],
	Merceria: [
		...voci(HOBBY, "Cucito", [
			dichiara("Filo per cucire in cotone (set di 10)", ...MATERIALE_COLORE),
			dichiara("Bottoni in madreperla", ...MATERIALE_COLORE),
			dichiara("Aghi da cucito assortiti", "Colore"),
			["Forbici da sarta", 12, 35],
			["Metro da sarta", 2, 5],
			"Puntaspilli",
			["Cerniera lampo 20 cm", 1, 3],
			dichiara(["Nastro di raso", 2, 5], ...MATERIALE),
			dichiara(["Ditale in metallo", 2, 5], ...MATERIALE),
			["Gessetto da sarto", 1, 3],
			["Spilli con capocchia (100 pezzi)", 2, 5],
			["Toppe termoadesive", 2, 6],
		]),
		...voci(HOBBY, "Maglia", [
			dichiara("Gomitolo di lana merino 50 g", ...MATERIALE),
			dichiara("Gomitolo di mohair 25 g", ...MATERIALE),
			dichiara("Filato di cotone 100 g", ...MATERIALE),
			dichiara("Ferri da maglia in bambù", ...MATERIALE_COLORE),
			dichiara(["Uncinetto in alluminio", 3, 7], ...MATERIALE),
		]),
		...voci(MODA, "Intimo", [
			dichiara(["Collant velati 20 denari", 4, 12], "Genere"),
			dichiara(["Calze di cotone (3 paia)", 6, 14], ...TESSUTO),
			dichiara(["Calzettoni in lana", 8, 16], ...TESSUTO_STAGIONE),
			dichiara(["Canottiera in lana e seta", 20, 40], ...TESSUTO_STAGIONE),
			dichiara(["Slip in cotone (3 pezzi)", 10, 22], ...TESSUTO),
		]),
	],
	Casalinghi: [
		// La misura nel nome è il diametro.
		...voci(CASA, "Pentole", [
			["Pentola a pressione 6 l", 50, 120],
			dichiara(
				"Casseruola in acciaio inox 20 cm",
				...MATERIALE_COLORE,
				"Larghezza",
				"Profondità",
			),
			"Pentola per pasta 5 l",
			dichiara(
				"Tegame in alluminio 28 cm",
				...MATERIALE,
				"Larghezza",
				"Profondità",
			),
		]),
		...voci(CASA, "Padelle", [
			dichiara("Padella antiaderente 28 cm", "Larghezza", "Profondità"),
			dichiara("Wok in acciaio al carbonio", ...MATERIALE_COLORE),
			dichiara("Bistecchiera in ghisa", ...MATERIALE_COLORE),
			dichiara("Padella per crêpes 24 cm", "Larghezza", "Profondità"),
		]),
		...voci(
			CASA,
			"Utensili cucina",
			[
				dichiara("Tagliere in legno d'ulivo", ...MATERIALE_COLORE),
				["Set di coltelli da cucina", 40, 150],
				dichiara(["Mestolo in acciaio", 5, 12], ...MATERIALE_COLORE),
				["Grattugia a quattro facce", 8, 18],
				dichiara(["Scolapasta in acciaio inox", 10, 20], ...MATERIALE_COLORE),
				["Spremiagrumi manuale", 5, 15],
				["Apriscatole", 4, 12],
				dichiara(["Frusta in acciaio", 4, 10], ...MATERIALE_COLORE),
				dichiara(["Mattarello in legno", 6, 15], ...MATERIALE_COLORE),
			],
			NON_ELETTRICO,
		),
		...voci(CASA, "Piccoli elettrodomestici", [
			"Bollitore elettrico 1,7 l",
			"Tostapane a due fette",
			"Frullatore a immersione",
			"Sbattitore elettrico",
		]),
		...voci(CASA, "Macchine caffè", [
			["Macchina per espresso con lancia vapore", 120, 350],
			// Si mette sul fornello; «3 tazze» è già la sua misura.
			dichiara(
				"Moka 3 tazze",
				"Potenza",
				"Peso",
				"Larghezza",
				"Altezza",
				"Profondità",
			),
		]),
	],
	"Ricambi auto": [
		...voci(
			AUTO,
			"Oli motore",
			[
				["Olio motore 5W-30 sintetico 4 l", 30, 55],
				["Olio motore 10W-40 semisintetico 4 l", 22, 40],
				dichiara("Olio motore per moto 10W-40 1 l", "Compatibilità veicolo"),
			],
			NON_MONTATO,
		),
		...voci(
			AUTO,
			"Batterie auto",
			[
				["Batteria auto 12 V 60 Ah", 70, 130],
				["Batteria auto 12 V 74 Ah", 90, 160],
			],
			NON_MONTATO,
		),
		...voci(AUTO, "Ricambi meccanici", [
			dichiara(["Pastiglie freno anteriori", 25, 60], "Posizione montaggio"),
			dichiara(
				["Dischi freno anteriori (coppia)", 50, 120],
				"Posizione montaggio",
			),
			"Filtro dell'aria",
			"Filtro dell'olio",
			"Filtro abitacolo",
			["Candele di accensione (set da 4)", 20, 45],
			["Cinghia di distribuzione", 40, 120],
			["Lampadina alogena H7", 5, 15],
		]),
		...voci(AUTO, "Accessori interni auto", [
			dichiara("Tappetini in gomma (set)", ...MATERIALE),
			dichiara("Coprisedili universali", "Compatibilità veicolo"),
			"Supporto smartphone da auto",
			"Organizer per bagagliaio",
		]),
		...voci(AUTO, "Accessori esterni auto", [
			"Spazzole tergicristallo 55 cm",
			"Telo copriauto",
			// Si montano sul tetto.
			dichiara(["Barre portatutto", 60, 150], "Posizione montaggio"),
		]),
		// Misura e stagione stanno nel nome.
		...voci(
			AUTO,
			"Pneumatici",
			[
				["Pneumatico estivo 205/55 R16", 60, 130],
				["Pneumatico invernale 195/65 R15", 60, 130],
			],
			[
				"Larghezza pneumatico",
				"Rapporto d'aspetto",
				"Diametro cerchio",
				"Stagione pneumatici",
			],
		),
		...voci(
			AUTO,
			"Caschi moto",
			[
				["Casco integrale", 90, 300],
				["Casco jet", 60, 200],
			],
			["Compatibilità veicolo", "Anno compatibilità", "Posizione montaggio"],
		),
		...voci(AUTO, "Accessori moto", [
			dichiara(["Bauletto per moto 32 l", 40, 120], "Posizione montaggio"),
			"Coprisella per moto",
		]),
	],
};

/** Marchi inventati, uno stile per macro: un seller li pesca dalle macro che vende. */
export const brandPoolByMacro: Record<string, readonly string[]> = {
	[FOOD]: [
		"Fratelli Zanardi",
		"Casa Morandi",
		"Corte dei Gelsi",
		"Antica Dispensa Lodi",
		"Famiglia Bonetti",
		"Villa Ardenza",
		"Cascina Belvedere",
		"Podere Ronchetti",
		"Terre di Sabbiuno",
	],
	[MODA]: [
		"Atelier Vanzetti",
		"Corradi Milano",
		"Linea Brenta",
		"Officine Bertoldi",
		"Contessa Livia",
		"Guidi & Rossetti",
		"Maison Ferraresi",
		"Monteluce",
	],
	[CASA]: [
		"Albertini Casa",
		"Focolare Italiano",
		"Desco",
		"Casa Sereni",
		"Tavola Lieta",
		"Officina Domestica",
		"Ca' Bianca",
		"Bottega Liberty",
	],
	[FAI_DA_TE]: [
		"Gatti Utensili",
		"Officine Brambilla",
		"Tecnoforte",
		"Valli Attrezzi",
		"Forgia Nord",
		"Robusta",
		"Maestranza",
		"Cantiere Italia",
	],
	[BELLEZZA]: [
		"Valsana Cosmetici",
		"Fiordaliso Cosmesi",
		"Officina Bellosguardo",
		"Laboratori Serafini",
		"Aurora Cosmesi",
		"Rugiada di Monte",
		"Linfa Viva",
		"Studio Ventura",
	],
	[LIBRI]: [
		"Edizioni Portico",
		"Lanterna Editore",
		"Il Vascello Edizioni",
		"Edizioni del Borgo",
		"Sestante Libri",
		"Nuvola Nera Edizioni",
		"Calamo Editore",
		"Edizioni Sant'Isaia",
	],
	[UFFICIO]: [
		"Calamaio",
		"Pagina Bianca",
		"Scrittoio Italiano",
		"Lapis & Co.",
		"Quadrifoglio Ufficio",
		"Carta Canta",
		"Archimede Ufficio",
		"Cancelleria Moderna",
	],
	[GIARDINO]: [
		"Verde Ginestra",
		"Serra Bellavista",
		"Orto e Fiore",
		"Terra Buona",
		"Morandini Vivai",
		"Gelsomino",
		"Il Giardino di Lia",
		"Prato Fiorito",
	],
	[SPORT]: [
		"Vetta Sport",
		"Dolomia",
		"Scatto",
		"Traguardo",
		"Altura",
		"Fuoriclasse",
		"Rimonta",
		"Ciclone",
	],
	[INFANZIA]: [
		"Girotondo",
		"Piccoli Passi",
		"Nuvoletta",
		"Coccolì",
		"Ninna Nanna",
		"Pulcino Blu",
		"Altalena",
		"Trottola",
	],
	[ELETTRONICA]: [
		"Elettra Lab",
		"Tecnovia",
		"Lumetta",
		"Arcadia Elettronica",
		"Sferica",
		"Dinamo",
		"Fulgore",
		"Onda Digitale",
	],
	[ANIMALI]: [
		"Zampa Felice",
		"Coda Allegra",
		"Baffi & Code",
		"Fiutò",
		"Muso Nero",
		"Orecchie Dritte",
		"Amico Fedele",
		"Cascina degli Animali",
	],
	[HOBBY]: [
		"Officina Creativa",
		"Laboratorio Gaia",
		"Atelier Ronchi",
		"Mani Abili",
		"Bottega dell'Estro",
		"Ingegno",
		"Creanza",
		"Arcobaleno Creativo",
	],
	[AUTO]: [
		"Meccanica Ferrante",
		"Officine Varano",
		"Motori Lario",
		"Strada Sicura",
		"Bertelli Ricambi",
		"Autotecnica Ponti",
		"Corsia Uno",
		"Asfalto",
	],
};

/** Descrizioni generiche per macro: devono stare bene su ogni voce della macro. */
export const descriptionsByMacro: Record<string, readonly string[]> = {
	[FOOD]: [
		"Selezionato da piccoli produttori italiani, con filiera corta e tracciabile.",
		"Lavorazione tradizionale che rispetta i tempi e la stagionalità delle materie prime.",
		"Sapore autentico e ingredienti semplici, come vuole la tradizione.",
		"Da portare in tavola per un pranzo in famiglia o una cena tra amici.",
		"Scelto assaggio dopo assaggio dal nostro banco, per offrirti solo il meglio.",
	],
	[MODA]: [
		"Taglio curato e materiali scelti per durare più di una stagione.",
		"Rifinito a mano nei dettagli, si abbina con facilità.",
		"Linee essenziali e uno stile che non passa di moda.",
		"Realizzato in Italia da laboratori artigiani di fiducia.",
		"Pensato per completare il tuo stile, dal giorno alla sera.",
	],
	[CASA]: [
		"Materiali resistenti e finiture curate, pensati per l'uso quotidiano.",
		"Design semplice che si inserisce con naturalezza in ogni ambiente.",
		"Facile da pulire e da riporre, senza rinunciare all'estetica.",
		"Un oggetto pratico che rende più piacevole la vita in casa.",
		"Un'idea regalo apprezzata da chi ama prendersi cura della casa.",
	],
	[FAI_DA_TE]: [
		"Robusto e affidabile, adatto sia all'hobbista sia al professionista.",
		"Progettato per lavori precisi e duraturi, in casa e in cantiere.",
		"Ergonomico e facile da usare, anche nei lavori più lunghi.",
		"Qualità professionale a un prezzo accessibile.",
		"Conforme alle normative europee di sicurezza.",
	],
	[BELLEZZA]: [
		"Pensato per la cura quotidiana, con risultati visibili nel tempo.",
		"Prodotto in Italia, non testato sugli animali.",
		"Scelto dai professionisti del settore per qualità e affidabilità.",
		"Un piccolo gesto di benessere da concedersi ogni giorno.",
		"Il nostro personale ti consiglia la scelta più adatta alle tue esigenze.",
	],
	[LIBRI]: [
		"Un'edizione curata, perfetta anche come regalo.",
		"Scelto dal nostro staff tra le novità e i grandi classici.",
		"Per appassionati e curiosi, da tenere sempre a portata di mano.",
		"Un titolo che non può mancare nella tua collezione.",
		"Ideale da regalare a chi ama le belle storie.",
	],
	[UFFICIO]: [
		"Materiali di qualità per lo studio e il lavoro di ogni giorno.",
		"Pratico e resistente, pensato per durare tutto l'anno.",
		"Ideale per la scuola, l'ufficio e lo studio a casa.",
		"Design semplice e funzionale, per tenere tutto in ordine.",
		"Un classico della cancelleria, scelto da studenti e professionisti.",
	],
	[GIARDINO]: [
		"Selezionato per dare soddisfazione stagione dopo stagione.",
		"Ideale per balconi, terrazzi e giardini di ogni dimensione.",
		"In negozio ti diamo tutti i consigli di cura e di utilizzo.",
		"Qualità da vivaio professionale, per chi ama il verde.",
		"Un'idea regalo sempre gradita per chi ama prendersi cura del verde.",
	],
	[SPORT]: [
		"Pensato per allenarsi con comfort e sicurezza.",
		"Leggero e resistente, adatto a principianti ed esperti.",
		"Scelto dai nostri esperti per prestazioni affidabili.",
		"Per vivere lo sport e il tempo libero senza pensieri.",
		"Materiali tecnici di qualità, costruito per durare.",
	],
	[INFANZIA]: [
		"Materiali sicuri e conformi alle normative europee.",
		"Pensato per accompagnare la crescita dei più piccoli.",
		"Pratico per i genitori, piacevole per i bambini.",
		"Scelto con cura per il benessere dei bambini.",
		"Consigliato da genitori ed educatori.",
	],
	[ELETTRONICA]: [
		"Tecnologia affidabile e facile da configurare.",
		"Due anni di garanzia e assistenza in negozio.",
		"Design curato, pensato per l'uso di tutti i giorni.",
		"Ottimo rapporto qualità prezzo, scelto dai nostri tecnici.",
		"Facile da usare fin dal primo giorno.",
	],
	[ANIMALI]: [
		"Pensato per il benessere quotidiano del tuo animale.",
		"Selezionato con cura dal nostro staff.",
		"Consigliato da allevatori e veterinari.",
		"Qualità e sicurezza per il tuo amico a quattro zampe.",
		"Scelto dai proprietari più esigenti.",
	],
	[HOBBY]: [
		"Ideale per principianti ed esperti di ogni età.",
		"Materiali di qualità per risultati che durano.",
		"Per dare forma alla tua creatività, un progetto alla volta.",
		"Scelto dal nostro staff per lavori precisi e curati.",
		"Un'idea regalo perfetta per chi ama creare con le mani.",
	],
	[AUTO]: [
		"Controlla la compatibilità con il tuo veicolo prima dell'acquisto.",
		"Prodotto conforme alle normative europee.",
		"Scelto dai nostri meccanici per affidabilità e durata.",
		"Per viaggiare sicuri, in città e in autostrada.",
		"Ottimo rapporto qualità prezzo.",
	],
};

/** Gli alcolici restano al 22% anche dentro «Alimentari e bevande» (10%). */
export const ALCOHOLIC_SUBS: ReadonlySet<string> = new Set([
	"Vino",
	"Birra",
	"Liquori e distillati",
]);

const entryByName = new Map(
	Object.values(catalogByPrefix)
		.flat()
		.map((e) => [e.name, e]),
);

/** La voce di catalogo di un prodotto del seed, dal suo nome esatto. */
export function catalogEntryByName(name: string): CatalogEntry | undefined {
	return entryByName.get(name);
}
