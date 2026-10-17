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
	/** Caratteristiche della sotto-categoria che per questo oggetto non hanno senso. */
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
const ATTREZZO_BELLEZZA = ["Formato", "Ingredienti principali"];
const NON_GIOCO_DA_TAVOLO = ["Numero giocatori", "Durata partita"];
const NON_MONTATO = ["Posizione montaggio"];

/** Un nome, o `[nome, min, max]` per chi esce dalla fascia di prezzo della macro. */
type Voce = string | readonly [name: string, min: number, max: number];

/** Più voci della stessa sotto-categoria. */
function voci(
	macro: string,
	sub: string,
	names: readonly Voce[],
	skip?: readonly string[],
): CatalogEntry[] {
	return names.map((v) => {
		const entry: CatalogEntry =
			typeof v === "string"
				? { name: v, macro, sub }
				: { name: v[0], macro, sub, price: [v[1], v[2]] };
		return skip ? { ...entry, skip } : entry;
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
		...voci(FOOD, "Formaggi e latticini", [
			"Parmigiano Reggiano DOP 24 mesi",
			"Pecorino romano DOP",
		]),
		...voci(
			FOOD,
			"Formaggi e latticini",
			[["Mozzarella fior di latte 250 g", 2, 4]],
			NON_STAGIONATO,
		),
		...voci(FOOD, "Salumi", ["Prosciutto di Parma DOP"]),
		...voci(FOOD, "Salumi", ["Mortadella Bologna IGP"], NON_STAGIONATO),
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
		...voci(FOOD, "Vino", [["Lambrusco di Sorbara DOC 75 cl", 6, 12]]),
	],
	Panificio: [
		...voci(FOOD, "Pane e prodotti da forno", [
			"Pane casereccio 1 kg",
			"Pane toscano sciapo",
			"Pane di semola rimacinata",
			"Pane integrale ai cereali",
			"Pagnotta di segale",
			["Ciabatta", 1, 3],
			["Michette (4 pezzi)", 2, 3],
			["Pane al latte (6 pezzi)", 2, 4],
			"Focaccia genovese",
			"Focaccia alle olive",
			"Schiacciata all'olio",
			["Grissini stirati a mano", 3, 6],
			["Tigelle (6 pezzi)", 3, 5],
			["Piadina romagnola (4 pezzi)", 3, 6],
			["Friselle integrali 500 g", 2, 4],
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
		...voci(FOOD, "Gelati", [
			"Semifreddo al torroncino",
			"Torta gelato al cioccolato",
		]),
	],
	Macelleria: [
		...voci(FOOD, "Carne", [
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
		]),
		...voci(FOOD, "Salumi", [
			"Prosciutto di Parma DOP",
			"Salame Felino IGP",
			"Pancetta arrotolata",
			"Coppa piacentina DOP",
		]),
		...voci(FOOD, "Salumi", ["Mortadella Bologna IGP"], NON_STAGIONATO),
		...voci(FOOD, "Piatti pronti", [
			"Involtini di vitello",
			"Spiedini misti di carne",
			["Cotolette impanate (4 pezzi)", 6, 10],
		]),
	],
	Enoteca: [
		...voci(FOOD, "Vino", [
			["Barolo DOCG 75 cl", 35, 70],
			["Barbaresco DOCG 75 cl", 30, 60],
			["Brunello di Montalcino DOCG 75 cl", 40, 80],
			["Amarone della Valpolicella DOCG 75 cl", 35, 70],
			["Chianti Classico DOCG 75 cl", 12, 25],
			["Primitivo di Manduria DOC 75 cl", 9, 18],
			"Nero d'Avola Sicilia DOC 75 cl",
			["Franciacorta Brut DOCG 75 cl", 20, 40],
			"Prosecco Superiore di Valdobbiadene DOCG 75 cl",
			["Lambrusco di Sorbara DOC 75 cl", 6, 12],
			"Verdicchio dei Castelli di Jesi DOC 75 cl",
			"Vermentino di Gallura DOCG 75 cl",
			"Gewürztraminer Alto Adige DOC 75 cl",
			"Montepulciano d'Abruzzo DOC 75 cl",
			"Moscato d'Asti DOCG 75 cl",
			["Sagrantino di Montefalco DOCG 75 cl", 20, 40],
		]),
		...voci(FOOD, "Birra", [
			["Birra artigianale chiara 33 cl", 3, 6],
			["Birra artigianale ambrata 33 cl", 3, 6],
			["Birra artigianale IPA 33 cl", 3, 6],
		]),
		...voci(FOOD, "Liquori e distillati", [
			"Grappa barricata 70 cl",
			"Limoncello 50 cl",
			"Amaro alle erbe 70 cl",
			"Nocino di Modena 50 cl",
			"Vermouth rosso di Torino 75 cl",
		]),
		...voci(FOOD, "Olio e condimenti", [
			"Olio extravergine toscano IGP 500 ml",
			["Aceto balsamico tradizionale di Modena DOP 100 ml", 40, 80],
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
		...voci(FOOD, "Vino", [
			["Vino rosso della casa 75 cl", 6, 12],
			["Vino bianco della casa 75 cl", 6, 12],
			["Chianti Classico DOCG 75 cl", 12, 25],
		]),
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
		...voci(FOOD, "Vino", [
			"Lambrusco Grasparossa di Castelvetro DOC 75 cl",
			"Sangiovese di Romagna DOC 75 cl",
			"Pignoletto frizzante DOC 75 cl",
		]),
		...voci(FOOD, "Dolci", [
			"Zuppa inglese",
			"Torta di riso",
			["Raviole bolognesi (6 pezzi)", 4, 7],
		]),
		...voci(FOOD, "Conserve", [["Ragù bolognese in vasetto 300 g", 5, 8]]),
		...voci(FOOD, "Olio e condimenti", [
			["Aceto balsamico di Modena IGP 250 ml", 4, 9],
		]),
	],
	Boutique: [
		...voci(MODA, "Abbigliamento donna", [
			["Abito lungo in seta", 120, 300],
			["Blazer in lana da donna", 90, 220],
			"Gonna plissettata",
			["Maglione in cashmere da donna", 120, 280],
			"Camicetta in viscosa",
			["Cappotto doppiopetto da donna", 180, 400],
			"Foulard in seta",
		]),
		...voci(MODA, "Abbigliamento uomo", [
			"Camicia in lino da uomo",
			"Pantaloni chino in cotone",
			["Giacca in velluto a coste", 90, 200],
			"Maglione girocollo in lana merino",
			["Trench impermeabile da uomo", 150, 350],
			"Sciarpa in lana",
		]),
		...voci(MODA, "Scarpe donna", [
			["Décolleté in pelle", 80, 200],
			["Stivaletti in camoscio", 90, 200],
		]),
		...voci(MODA, "Scarpe uomo", [
			["Mocassini in pelle", 80, 180],
			["Stringate in pelle", 90, 220],
		]),
		...voci(MODA, "Sneakers", [["Sneakers in pelle bianche", 70, 160]]),
		...voci(MODA, "Borse", [
			["Borsa a tracolla in pelle", 80, 250],
			"Pochette da sera",
		]),
		...voci(MODA, "Cappelli", ["Cappello in feltro"]),
		...voci(MODA, "Cinture", ["Cintura in pelle intrecciata"]),
	],
	Gioielleria: [
		...voci(MODA, "Gioielli", [
			["Anello solitario in oro bianco", 400, 1500],
			["Fede nuziale in oro giallo", 150, 400],
			["Collana di perle", 150, 500],
			["Orecchini a cerchio in oro", 80, 250],
			["Orecchini pendenti in argento", 30, 80],
			["Bracciale tennis in argento", 60, 150],
			["Ciondolo a cuore in oro rosa", 80, 200],
			["Catenina in oro giallo", 100, 300],
			["Anello con zaffiro", 300, 1200],
			["Bracciale rigido in argento", 40, 100],
			"Spilla in argento",
			"Gemelli da polso in argento",
			"Orecchini con perla",
			"Collana con pendente in argento",
		]),
		...voci(
			MODA,
			"Orologi",
			[
				["Orologio automatico in acciaio", 250, 900],
				["Orologio da donna con cinturino in pelle", 80, 300],
				["Cronografo in acciaio", 200, 800],
				["Orologio da taschino", 80, 300],
				["Orologio da immersione", 200, 800],
				["Orologio al quarzo da uomo", 80, 250],
				["Orologio solo tempo con cassa in oro", 1500, 5000],
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
		...voci(BELLEZZA, "Integratori", [
			"Propoli in gocce 30 ml",
			"Pappa reale fresca 10 g",
			"Echinacea in compresse",
			"Magnesio e potassio in bustine",
			"Valeriana in capsule",
			"Spirulina in compresse",
		]),
		...voci(BELLEZZA, "Vitamine", ["Vitamina C da acerola in compresse"]),
		...voci(BELLEZZA, "Creme viso", [
			"Crema viso all'aloe vera 50 ml",
			"Crema alla calendula 50 ml",
			"Burro di karité puro 100 ml",
		]),
		...voci(BELLEZZA, "Shampoo", [["Shampoo all'ortica 250 ml", 6, 10]]),
		...voci(BELLEZZA, "Balsamo", [["Balsamo all'olio di argan 200 ml", 7, 12]]),
	],
	Fiorista: [
		...voci(GIARDINO, "Fiori", [
			["Mazzo di rose rosse (12 steli)", 25, 45],
			["Bouquet di tulipani", 15, 30],
			["Mazzo di girasoli", 12, 25],
			["Bouquet di peonie", 25, 45],
			"Mazzo di margherite",
			"Ranuncoli misti",
			"Gerbere colorate",
			"Lilium bianchi",
			"Calle bianche",
			"Bouquet di fiori di campo",
			["Bouquet da sposa", 80, 200],
			"Mazzo di lavanda essiccata",
			["Composizione floreale in cesto", 35, 70],
			["Mazzo di mimosa", 5, 10],
			["Rosa singola con nastro", 3, 6],
		]),
		...voci(GIARDINO, "Piante", [
			"Orchidea phalaenopsis in vaso",
			"Ortensia in vaso",
			"Pothos in vaso sospeso",
			"Sansevieria",
			["Stella di Natale", 6, 15],
		]),
		...voci(CASA, "Decorazioni casa", [
			"Vaso in vetro soffiato",
			"Ghirlanda di fiori secchi",
		]),
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
		...voci(FAI_DA_TE, "Vernici", [
			"Smalto all'acqua bianco lucido 750 ml",
			"Impregnante per legno noce 2,5 l",
			["Idropittura traspirante bianca 14 l", 30, 70],
			"Antiruggine grigio 750 ml",
		]),
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
			["Viti per legno assortite", 5, 10],
			["Tasselli in nylon (100 pezzi)", 4, 8],
			["Set di chiavi a brugola", 8, 15],
			["Martello da carpentiere", 12, 25],
			["Metro a nastro 5 m", 5, 12],
			["Lucchetto in ottone", 8, 18],
		]),
		...voci(FAI_DA_TE, "Sicurezza lavoro", [
			["Guanti da lavoro in nitrile", 3, 8],
			["Occhiali protettivi", 4, 10],
			["Scarpe antinfortunistiche", 40, 90],
		]),
	],
	Ceramiche: [
		...voci(CASA, "Decorazioni casa", [
			["Vaso in ceramica di Deruta", 40, 120],
			["Piatto decorativo da parete", 25, 70],
			["Testa di moro in ceramica", 60, 200],
			"Ciotola decorativa smaltata",
			["Centrotavola in ceramica", 30, 80],
			["Portaombrelli in ceramica", 50, 120],
			"Lanterna in ceramica traforata",
			"Formella in ceramica dipinta a mano",
			["Pigna in ceramica di Caltagirone", 30, 90],
			"Portafrutta in ceramica",
		]),
		...voci(CASA, "Lampade", [
			["Lampada da tavolo in ceramica", 50, 140],
			["Lampada da comodino in ceramica", 40, 100],
		]),
		...voci(CASA, "Pentole", [
			"Tegame in terracotta",
			"Fagioliera in terracotta",
			"Pentola in coccio",
		]),
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
			NON_ELETTRICO,
		),
		...voci(CASA, "Candele", [["Candela in vasetto di ceramica", 12, 25]]),
	],
	Pelletteria: [
		...voci(MODA, "Borse", [
			["Borsa a mano in pelle", 120, 350],
			["Borsa shopper in pelle", 100, 280],
			["Borsa a tracolla in pelle", 80, 250],
			["Borsa a spalla in pelle martellata", 120, 320],
			["Borsa secchiello in pelle", 100, 260],
			["Bauletto in pelle", 120, 300],
			["Borsello da uomo in pelle", 50, 130],
			["Portadocumenti in pelle", 90, 220],
			["Cartella da lavoro in pelle", 120, 300],
			"Marsupio in pelle",
		]),
		...voci(MODA, "Zaini", [
			["Zaino in pelle", 120, 300],
			["Zaino porta PC in pelle", 130, 320],
			["Zainetto in pelle da donna", 90, 220],
		]),
		...voci(MODA, "Valigie", [
			["Borsone da viaggio in pelle", 150, 400],
			["Trolley da cabina", 80, 220],
			"Beauty case in pelle",
			["Valigia rigida grande", 120, 350],
		]),
		...voci(MODA, "Cinture", [
			"Cintura in pelle intrecciata",
			"Cintura in cuoio con fibbia in ottone",
			"Cintura reversibile in pelle",
		]),
	],
	Gelateria: [
		...voci(FOOD, "Gelati", [
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
			"Cassata gelato",
			"Semifreddo al torroncino",
			"Torta gelato al cioccolato",
			["Tartufo gelato al cioccolato", 3, 6],
			["Granita al limone", 2, 4],
			["Ghiaccioli alla frutta (4 pezzi)", 3, 6],
		]),
		...voci(FOOD, "Dolci", [
			["Coni in cialda (12 pezzi)", 3, 6],
			["Brioche col tuppo (4 pezzi)", 4, 7],
			["Meringhe 150 g", 3, 5],
		]),
	],
	Pizzeria: [
		...voci(FOOD, "Piatti pronti", [
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
		]),
		...voci(FOOD, "Dolci", ["Tiramisù", ["Babà napoletano", 3, 6]]),
		...voci(FOOD, "Vino", [
			["Gragnano della Penisola Sorrentina DOC 75 cl", 8, 13],
		]),
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
		...voci(FOOD, "Vino", [
			["Chianti Classico DOCG 75 cl", 12, 25],
			["Rosso di Montalcino DOC 75 cl", 18, 30],
			["Vino Nobile di Montepulciano DOCG 75 cl", 15, 28],
			"Vernaccia di San Gimignano DOCG 75 cl",
		]),
		...voci(FOOD, "Dolci", [
			["Cantucci alle mandorle 250 g", 4, 7],
			"Castagnaccio",
			"Schiacciata alla fiorentina",
		]),
		...voci(FOOD, "Conserve", [["Sugo di cinghiale in vasetto 300 g", 5, 9]]),
		...voci(FOOD, "Olio e condimenti", [
			"Olio extravergine toscano IGP 500 ml",
		]),
	],
	Caffetteria: [
		...voci(FOOD, "Caffè", [
			["Caffè in grani miscela arabica 1 kg", 14, 25],
			["Caffè macinato per moka 250 g", 3, 6],
			"Caffè decaffeinato macinato 250 g",
			["Cialde di caffè in carta (50 pezzi)", 9, 15],
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
		...voci(FOOD, "Piatti pronti", [
			["Toast prosciutto e formaggio", 3, 5],
			["Tramezzino tonno e carciofi", 2, 4],
			["Piadina crudo e squacquerone", 5, 8],
		]),
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
			["Abito sartoriale su misura", 800, 2500],
			["Camicia su misura in popeline", 90, 200],
			["Giacca in tweed su misura", 500, 1200],
			["Giacca in lino su misura", 450, 1100],
			["Pantaloni in flanella su misura", 200, 450],
			["Gilet in lana", 80, 180],
			["Cappotto in cammello su misura", 900, 2500],
			["Smoking su misura", 1000, 2800],
			["Tight da cerimonia", 900, 2400],
			["Cravatta in seta", 50, 120],
			["Papillon in seta", 40, 90],
			"Pochette da taschino in seta",
		]),
		...voci(MODA, "Abbigliamento donna", [
			["Tailleur su misura", 700, 1800],
			["Abito da cerimonia su misura", 800, 2200],
			["Gonna a tubino su misura", 180, 400],
			["Camicia da donna su misura", 90, 200],
			["Pantaloni palazzo su misura", 200, 450],
			["Cappotto da donna su misura", 900, 2400],
			["Mantella in lana su misura", 400, 1000],
		]),
		...voci(MODA, "Cappelli", ["Coppola in tweed"]),
	],
	Ottica: [
		...voci(MODA, "Occhiali da sole", [
			["Occhiali da sole polarizzati", 90, 200],
			["Occhiali da sole aviator", 80, 190],
			["Occhiali da sole rotondi in acetato", 80, 180],
			["Occhiali da sole cat-eye", 80, 180],
			["Occhiali da sole sportivi avvolgenti", 70, 160],
			"Occhiali da sole da bambino",
			["Occhiali da sole pieghevoli", 80, 170],
			["Occhiali da sole con lenti specchiate", 80, 180],
			["Occhiali da sole in titanio", 150, 320],
			["Occhiali da sole oversize", 80, 190],
			["Occhiali da sole squadrati", 80, 180],
			["Occhiali da sole fotocromatici", 120, 260],
			["Occhiali da sole con lenti sfumate", 80, 180],
			["Occhiali da sole in legno", 90, 200],
			["Occhiali da sole a mascherina", 90, 200],
			"Clip da sole per occhiali da vista",
			["Occhiali da sole da guida", 90, 200],
			["Occhiali da sole con montatura trasparente", 80, 180],
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
			"Dopobarba profumato 100 ml",
		]),
		...voci(BELLEZZA, "Make-up viso", [
			"Fondotinta fluido",
			"Cipria compatta",
			"Correttore liquido",
			"Blush in polvere",
		]),
		...voci(BELLEZZA, "Make-up occhi", [
			"Mascara volumizzante",
			["Matita occhi nera", 6, 12],
			"Palette di ombretti",
			"Eyeliner liquido",
		]),
		...voci(BELLEZZA, "Make-up labbra", [
			"Rossetto matte",
			"Gloss labbra",
			["Matita labbra", 6, 12],
		]),
		...voci(BELLEZZA, "Creme viso", [
			"Crema viso idratante 50 ml",
			"Crema antirughe notte 50 ml",
		]),
		...voci(BELLEZZA, "Sieri", [
			"Siero alla vitamina C 30 ml",
			"Siero all'acido ialuronico 30 ml",
		]),
	],
	Cartoleria: [
		...voci(UFFICIO, "Penne", [
			["Penna stilografica", 20, 80],
			["Penne a sfera blu (10 pezzi)", 3, 7],
			["Penna gel cancellabile", 1, 3],
			["Evidenziatori (4 colori)", 3, 7],
		]),
		...voci(UFFICIO, "Matite", [
			["Matite in grafite HB (12 pezzi)", 3, 7],
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
			"Rastrello in acciaio",
			"Vanga con manico in legno",
			["Guanti da giardinaggio", 5, 12],
			["Tagliasiepi elettrico", 60, 150],
		]),
		...voci(GIARDINO, "Irrigazione", [
			"Tubo da giardino 25 m",
			"Irrigatore oscillante",
			"Annaffiatoio in metallo 10 l",
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
		...voci(FOOD, "Salumi", [
			"Prosciutto di Parma DOP",
			"Culatello di Zibello DOP",
			"Salame Felino IGP",
		]),
		...voci(FOOD, "Salumi", ["Mortadella Bologna IGP"], NON_STAGIONATO),
		...voci(FOOD, "Formaggi e latticini", [
			"Parmigiano Reggiano DOP 24 mesi",
			"Gorgonzola dolce DOP",
		]),
		...voci(
			FOOD,
			"Formaggi e latticini",
			[
				["Squacquerone di Romagna DOP", 3, 6],
				["Ricotta di pecora", 3, 6],
			],
			NON_STAGIONATO,
		),
		...voci(FOOD, "Conserve", [
			["Carciofini sott'olio 280 g", 4, 7],
			"Funghi porcini secchi 50 g",
		]),
		...voci(FOOD, "Olio e condimenti", [
			["Aceto balsamico di Modena IGP 250 ml", 4, 9],
		]),
	],

	// ── Blocco bolognese (`bolognaPrefixes`) ──────────────
	Pescheria: [
		...voci(FOOD, "Pesce", [
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
		]),
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
		...voci(FOOD, "Birra", [
			["Birra lager in bottiglia 66 cl", 1, 3],
			["Birra artigianale chiara 33 cl", 3, 6],
			["Birra rossa doppio malto 33 cl", 2, 4],
			["Birra weiss 50 cl", 2, 4],
		]),
		...voci(FOOD, "Vino", [
			"Pignoletto frizzante DOC 75 cl",
			"Prosecco DOC extra dry 75 cl",
		]),
		...voci(FOOD, "Liquori e distillati", [
			"Amaro alle erbe 70 cl",
			"Limoncello 50 cl",
			"Bitter rosso per aperitivo 70 cl",
			"Grappa bianca 70 cl",
		]),
		...voci(FOOD, "Bevande analcoliche", [
			["Chinotto 33 cl", 1, 3],
			["Acqua tonica 20 cl", 1, 2],
			["Tè freddo alla pesca 50 cl", 2, 4],
		]),
		...voci(FOOD, "Piatti pronti", [
			["Piadina crudo e squacquerone", 5, 8],
			["Toast prosciutto e formaggio", 3, 5],
			["Tramezzino tonno e carciofi", 2, 4],
		]),
		...voci(FOOD, "Dolci", [["Cornetto alla crema", 1, 3]]),
	],
	Parrucchiere: [
		...voci(BELLEZZA, "Shampoo", [
			"Shampoo nutriente per capelli secchi 250 ml",
			"Shampoo antiforfora 250 ml",
			"Shampoo per capelli colorati 250 ml",
			"Shampoo delicato per uso frequente 250 ml",
			"Shampoo ristrutturante 1 l",
			"Shampoo secco 200 ml",
		]),
		...voci(BELLEZZA, "Balsamo", [
			"Balsamo districante 200 ml",
			"Maschera per capelli alla cheratina 250 ml",
			"Balsamo senza risciacquo 150 ml",
			"Balsamo per capelli ricci 200 ml",
		]),
		...voci(BELLEZZA, "Styling capelli", [
			"Lacca a tenuta forte 400 ml",
			"Mousse volumizzante 200 ml",
			"Cera opaca 100 ml",
			"Spray termoprotettore 150 ml",
			"Gel fissante 150 ml",
			"Olio per punte secche 50 ml",
			"Crema per ricci 150 ml",
		]),
		...voci(
			BELLEZZA,
			"Styling capelli",
			[
				["Asciugacapelli professionale 2000 W", 60, 150],
				["Piastra per capelli in ceramica", 40, 120],
				["Ferro arricciacapelli", 30, 80],
			],
			ATTREZZO_BELLEZZA,
		),
	],
	Barbiere: [
		...voci(BELLEZZA, "Shampoo", [
			"Shampoo da uomo rinforzante 250 ml",
			"Shampoo per barba 150 ml",
		]),
		...voci(BELLEZZA, "Styling capelli", [
			"Cera opaca 100 ml",
			"Gel fissante 150 ml",
			"Pomata lucida per capelli 100 ml",
			"Tonico per capelli 200 ml",
		]),
		...voci(
			BELLEZZA,
			"Styling capelli",
			["Pettine in corno", "Spazzola per barba in setola"],
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
			"Olio da barba 30 ml",
			"Crema da barba 150 ml",
			"Balsamo per barba 50 ml",
			"Crema idratante viso da uomo 50 ml",
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
			"Miniature fantasy da dipingere",
			"Modellino di astronave da montare",
		]),
		...voci(HOBBY, "Colori", ["Colori acrilici per miniature (set)"]),
	],
	Biciclette: [
		...voci(SPORT, "Biciclette", [
			["City bike da donna 28 pollici", 250, 600],
			["City bike da uomo 28 pollici", 250, 600],
			["Mountain bike front 29 pollici", 400, 1200],
			["Bici da corsa in alluminio", 700, 1800],
			["Bici gravel", 800, 2000],
			["Bici da trekking", 500, 1200],
			["Bici pieghevole 20 pollici", 300, 800],
			["Bici elettrica da città", 1200, 3000],
			["Bicicletta da bambino 16 pollici", 120, 300],
			["Bici senza pedali", 40, 120],
		]),
		...voci(
			SPORT,
			"Accessori bici",
			[
				["Casco da bici", 30, 120],
				"Luci LED per bici (coppia)",
				"Lucchetto ad arco",
				["Campanello in ottone", 5, 15],
				"Pompa da pavimento con manometro",
				["Borraccia da bici 750 ml", 5, 15],
				"Sella in gel",
				["Cavalletto laterale", 10, 25],
				"Parafanghi (coppia)",
			],
			TELAIO_BICI,
		),
		...voci(
			SPORT,
			"Accessori bici",
			[["Camera d'aria 700x28c", 5, 12], "Copertone da città 700x35c"],
			TELAIO_BICI.filter((c) => c !== "Diametro ruote"),
		),
		...voci(
			SPORT,
			"Accessori bici",
			[
				"Portapacchi posteriore",
				["Seggiolino posteriore per bambini", 50, 130],
			],
			TELAIO_BICI.filter((c) => c !== "Peso massimo supportato"),
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
			["Blocco yoga in sughero", 8, 18],
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
			["Cuffia in silicone", 5, 15],
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
				"Puzzle in legno 24 pezzi",
				"Abaco in legno",
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
			["Trenino in legno con binari", 25, 60],
			"Costruzioni in legno",
		]),
		...voci(HOBBY, "Modellismo", [
			"Modellino d'auto da montare in scala 1:24",
			"Aeromodello in balsa",
		]),
		...voci(HOBBY, "Kit fai da te", [
			"Kit braccialetti con perline",
			"Kit di pasta modellabile",
			"Kit per dipingere i sassi",
		]),
	],
	Elettronica: [
		...voci(ELETTRONICA, "Smartphone", [
			["Smartphone Android 128 GB", 150, 400],
		]),
		...voci(ELETTRONICA, "Tablet", [["Tablet 10 pollici 64 GB", 150, 350]]),
		...voci(ELETTRONICA, "Laptop", [
			["Notebook 15,6 pollici 512 GB", 450, 1000],
		]),
		...voci(ELETTRONICA, "Monitor", [["Monitor 27 pollici QHD", 200, 400]]),
		...voci(ELETTRONICA, "Mouse", ["Mouse wireless ergonomico"]),
		...voci(ELETTRONICA, "Tastiere", [
			["Tastiera meccanica retroilluminata", 50, 130],
		]),
		...voci(ELETTRONICA, "Webcam", [["Webcam Full HD con microfono", 30, 80]]),
		...voci(ELETTRONICA, "Cuffie", [
			["Cuffie wireless con cancellazione del rumore", 100, 300],
			["Cuffie da gaming con microfono", 40, 120],
		]),
		...voci(ELETTRONICA, "Auricolari", [["Auricolari true wireless", 40, 150]]),
		...voci(ELETTRONICA, "Speaker Bluetooth", [
			["Speaker Bluetooth impermeabile", 40, 120],
		]),
		...voci(ELETTRONICA, "Smart TV", [["Smart TV 55 pollici 4K", 400, 900]]),
		...voci(ELETTRONICA, "Console", [["Console portatile", 200, 400]]),
		...voci(
			ELETTRONICA,
			"Videogiochi",
			[
				["Videogioco di corse automobilistiche", 30, 70],
				["Videogioco d'avventura", 30, 70],
			],
			["Alimentazione", "Potenza"],
		),
		...voci(
			ELETTRONICA,
			"Accessori console",
			[["Controller wireless per console", 40, 75]],
			["Potenza"],
		),
		...voci(ELETTRONICA, "Smartwatch", [["Smartwatch con GPS", 150, 400]]),
		...voci(ELETTRONICA, "Fitness tracker", [
			["Braccialetto fitness con cardiofrequenzimetro", 30, 80],
		]),
		...voci(ELETTRONICA, "eReader", [["eReader 6 pollici", 100, 200]]),
		...voci(ELETTRONICA, "Power bank", ["Power bank 20.000 mAh"]),
		...voci(ELETTRONICA, "Caricabatterie", ["Caricatore USB-C 65 W"]),
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
			["Smartphone Android 128 GB", 150, 400],
			["Smartphone Android 256 GB", 250, 600],
			["Smartphone compatto 5G 128 GB", 200, 500],
			["Smartphone rinforzato 64 GB", 150, 350],
		]),
		...voci(
			ELETTRONICA,
			"Custodie smartphone",
			[
				"Custodia in silicone",
				"Custodia a libro in ecopelle",
				"Cover trasparente antiurto",
			],
			CUSTODIA,
		),
		...voci(
			ELETTRONICA,
			"Custodie smartphone",
			["Pellicola protettiva in vetro temperato"],
			[...CUSTODIA, "Tipo chiusura"],
		),
		...voci(ELETTRONICA, "Caricabatterie", [
			"Caricatore USB-C 65 W",
			"Caricatore USB-C 20 W",
			"Caricatore wireless 15 W",
			"Caricatore da auto con doppia USB",
		]),
		...voci(ELETTRONICA, "Power bank", [
			"Power bank 20.000 mAh",
			"Power bank magnetico 5.000 mAh",
		]),
		...voci(ELETTRONICA, "Auricolari", [
			["Auricolari true wireless", 40, 150],
			"Auricolari sportivi con archetto",
		]),
		...voci(ELETTRONICA, "Cuffie", ["Cuffie Bluetooth pieghevoli"]),
		...voci(ELETTRONICA, "Smartwatch", [
			["Smartwatch con GPS", 150, 400],
			["Smartwatch con chiamate Bluetooth", 60, 200],
		]),
		...voci(ELETTRONICA, "Tablet", [
			["Tablet 10 pollici 64 GB", 150, 350],
			["Tablet 8 pollici 32 GB", 100, 200],
		]),
		...voci(ELETTRONICA, "Fitness tracker", [
			["Braccialetto fitness con cardiofrequenzimetro", 30, 80],
		]),
	],
	Copisteria: [
		...voci(UFFICIO, "Cartucce", [
			["Cartuccia d'inchiostro nero compatibile", 8, 20],
			["Cartucce a colori (confezione da 3)", 15, 35],
			["Toner nero per stampante laser", 25, 70],
			["Kit di ricarica inchiostro", 10, 20],
		]),
		...voci(UFFICIO, "Stampanti", [
			["Stampante multifunzione a getto d'inchiostro", 60, 180],
			["Stampante laser monocromatica", 90, 220],
		]),
		...voci(UFFICIO, "Organizer", [
			["Raccoglitore ad anelli", 3, 7],
			["Cartellina con elastico", 2, 4],
			["Portalistini 40 buste", 3, 7],
			["Buste trasparenti forate (100 pezzi)", 4, 9],
			"Copertine per rilegatura (100 pezzi)",
			"Etichette adesive A4 (100 fogli)",
		]),
		...voci(UFFICIO, "Quaderni", [
			["Blocco notes A4 a quadretti", 2, 5],
			["Quaderno A4 a righe", 2, 4],
		]),
		...voci(UFFICIO, "Penne", [
			["Penne a sfera blu (10 pezzi)", 3, 7],
			["Evidenziatori (4 colori)", 3, 7],
			["Marcatore indelebile nero", 1, 4],
			["Penna roller nera", 2, 5],
		]),
		...voci(UFFICIO, "Agende", ["Agenda settimanale con copertina rigida"]),
		...voci(UFFICIO, "Matite", [["Matite in grafite HB (12 pezzi)", 3, 7]]),
	],
	"Pet shop": [
		...voci(ANIMALI, "Cibo cani", [
			["Crocchette per cani adulti 3 kg", 12, 25],
			["Crocchette per cuccioli 1,5 kg", 9, 18],
			["Bocconcini per cani al manzo 400 g", 1, 3],
		]),
		...voci(ANIMALI, "Cibo gatti", [
			["Crocchette per gatti sterilizzati 1,5 kg", 9, 18],
			["Bocconcini per gatti al salmone 85 g", 1, 2],
			["Paté per gatti al pollo 100 g", 1, 3],
		]),
		...voci(ANIMALI, "Snack animali", [
			"Snack dentali per cani",
			"Biscotti per cani 500 g",
			["Snack cremosi per gatti", 2, 5],
		]),
		...voci(ANIMALI, "Cucce", [
			["Cuccia in tessuto imbottita", 20, 50],
			["Cuscino per cani lavabile", 15, 40],
			["Casetta per gatti", 20, 50],
		]),
		...voci(ANIMALI, "Trasportini", [
			["Trasportino rigido per gatti", 20, 45],
			["Borsa trasportino per cani piccoli", 20, 45],
		]),
		...voci(ANIMALI, "Guinzagli", [
			["Guinzaglio in nylon", 6, 14],
			["Guinzaglio allungabile 5 m", 12, 28],
		]),
		...voci(ANIMALI, "Collari", [
			"Collare in pelle per cani",
			["Collare per gatti con campanello", 4, 10],
			"Pettorina regolabile",
		]),
		...voci(ANIMALI, "Giochi animali", [
			["Tiragraffi a colonna", 25, 80],
			["Pallina per cani in gomma", 2, 6],
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
		...voci(BELLEZZA, "Integratori", [
			"Fermenti lattici in flaconcini",
			"Magnesio e potassio in bustine",
			"Integratore di ferro",
			"Omega 3 in perle",
			["Collagene in polvere", 20, 35],
		]),
		...voci(BELLEZZA, "Vitamine", [
			"Vitamina D3 in gocce",
			"Multivitaminico in compresse",
			"Vitamina C effervescente",
		]),
		...voci(BELLEZZA, "Creme viso", [
			"Crema solare viso SPF 50",
			"Crema idratante per pelli sensibili 50 ml",
			"Crema riparatrice per pelli secche 50 ml",
		]),
		...voci(BELLEZZA, "Shampoo", ["Shampoo dermatologico delicato 200 ml"]),
		...voci(INFANZIA, "Prodotti allattamento", [
			"Biberon anticolica 260 ml",
			"Tiralatte manuale",
			["Ciuccio in silicone 0–6 mesi", 4, 9],
			["Coppette assorbilatte (30 pezzi)", 5, 9],
		]),
		...voci(INFANZIA, "Pannolini", [
			"Pannolini taglia 3 (30 pezzi)",
			"Pannolini taglia 4 (28 pezzi)",
			"Mutandine assorbenti taglia 5 (20 pezzi)",
		]),
		...voci(FOOD, "Senza glutine", [
			["Biscotti senza glutine 250 g", 3, 5],
			["Pane in cassetta senza glutine 300 g", 3, 5],
			["Fusilli di mais e riso senza glutine 400 g", 2, 4],
		]),
	],
	Merceria: [
		...voci(HOBBY, "Cucito", [
			"Filo per cucire in cotone (set di 10)",
			"Bottoni in madreperla",
			"Aghi da cucito assortiti",
			["Forbici da sarta", 12, 35],
			["Metro da sarta", 2, 5],
			"Puntaspilli",
			["Cerniera lampo 20 cm", 1, 3],
			["Nastro di raso", 2, 5],
			["Ditale in metallo", 2, 5],
			["Gessetto da sarto", 1, 3],
			["Spilli con capocchia (100 pezzi)", 2, 5],
			["Toppe termoadesive", 2, 6],
		]),
		...voci(HOBBY, "Maglia", [
			"Gomitolo di lana merino 50 g",
			"Gomitolo di mohair 25 g",
			"Filato di cotone 100 g",
			"Ferri da maglia in bambù",
			["Uncinetto in alluminio", 3, 7],
		]),
		...voci(MODA, "Intimo", [
			["Collant velati 20 denari", 4, 12],
			["Calze di cotone (3 paia)", 6, 14],
			["Calzettoni in lana", 8, 16],
			["Canottiera in lana e seta", 20, 40],
			["Slip in cotone (3 pezzi)", 10, 22],
		]),
	],
	Casalinghi: [
		...voci(CASA, "Pentole", [
			["Pentola a pressione 6 l", 50, 120],
			"Casseruola in acciaio inox 20 cm",
			"Pentola per pasta 5 l",
			"Tegame in alluminio 28 cm",
		]),
		...voci(CASA, "Padelle", [
			"Padella antiaderente 28 cm",
			"Wok in acciaio al carbonio",
			"Bistecchiera in ghisa",
			"Padella per crêpes 24 cm",
		]),
		...voci(
			CASA,
			"Utensili cucina",
			[
				"Tagliere in legno d'ulivo",
				["Set di coltelli da cucina", 40, 150],
				["Mestolo in acciaio", 5, 12],
				["Grattugia a quattro facce", 8, 18],
				["Scolapasta in acciaio inox", 10, 20],
				["Spremiagrumi manuale", 5, 15],
				"Caffettiera moka 3 tazze",
				["Apriscatole", 4, 12],
				["Frusta in acciaio", 4, 10],
				["Mattarello in legno", 6, 15],
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
		]),
	],
	"Ricambi auto": [
		...voci(
			AUTO,
			"Oli motore",
			[
				["Olio motore 5W-30 sintetico 4 l", 30, 55],
				["Olio motore 10W-40 semisintetico 4 l", 22, 40],
				"Olio motore per moto 10W-40 1 l",
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
			["Pastiglie freno anteriori", 25, 60],
			["Dischi freno anteriori (coppia)", 50, 120],
			"Filtro dell'aria",
			"Filtro dell'olio",
			"Filtro abitacolo",
			["Candele di accensione (set da 4)", 20, 45],
			["Cinghia di distribuzione", 40, 120],
			["Lampadina alogena H7", 5, 15],
		]),
		...voci(AUTO, "Accessori interni auto", [
			"Tappetini in gomma (set)",
			"Coprisedili universali",
			"Supporto smartphone da auto",
			"Organizer per bagagliaio",
		]),
		...voci(AUTO, "Accessori esterni auto", [
			"Spazzole tergicristallo 55 cm",
			"Telo copriauto",
			["Barre portatutto", 60, 150],
		]),
		...voci(AUTO, "Pneumatici", [
			["Pneumatico estivo 205/55 R16", 60, 130],
			["Pneumatico invernale 195/65 R15", 60, 130],
		]),
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
			["Bauletto per moto 32 l", 40, 120],
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
