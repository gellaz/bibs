import { count } from "drizzle-orm";
import { db } from "@/db";
import { productCategory } from "@/db/schemas/category";
import { storeCategory } from "@/db/schemas/store-category";

// ── Store categories ────────────────────────

const storeCategories = [
	"Alimentari",
	"Abbigliamento",
	"Elettronica",
	"Casa e arredamento",
	"Sport e tempo libero",
	"Salute e bellezza",
	"Libreria e cartoleria",
	"Gioielleria e accessori",
	"Ristorazione",
	"Servizi",
	"Altro",
];

// ── Product categories ──────────────────────

const productCategories = [
	"Frutta e verdura",
	"Pane e prodotti da forno",
	"Pasta e riso",
	"Carne e salumi",
	"Pesce e frutti di mare",
	"Latticini e formaggi",
	"Uova",
	"Olio e condimenti",
	"Conserve e sottoli",
	"Farine e cereali",
	"Legumi",
	"Spezie e aromi",
	"Dolci e pasticceria",
	"Cioccolato e confetti",
	"Gelati e sorbetti",
	"Bevande analcoliche",
	"Vino",
	"Birra artigianale",
	"Liquori e distillati",
	"Caffè e tè",
	"Miele e confetture",
	"Snack e frutta secca",
	"Prodotti biologici",
	"Prodotti senza glutine",
	"Prodotti vegani",
	"Cosmetici naturali",
	"Saponi e detergenti",
	"Candele e profumi",
	"Ceramiche e terracotta",
	"Tessuti e stoffe",
	"Abbigliamento artigianale",
	"Borse e pelletteria",
	"Gioielli artigianali",
	"Bigiotteria",
	"Oggettistica e souvenir",
	"Giocattoli in legno",
	"Articoli per la casa",
	"Piante e fiori",
	"Sementi e giardinaggio",
	"Prodotti per animali",
	"Libri e riviste",
	"Cartoleria e cancelleria",
	"Articoli per feste",
	"Fotografia e stampe",
	"Musica e vinili",
	"Antiquariato e vintage",
	"Elettronica e accessori",
	"Attrezzatura sportiva",
	"Articoli per bambini",
	"Prodotti per la salute",
];

// ── Seeding functions ───────────────────────

export async function seedStoreCategories() {
	const [{ total }] = await db.select({ total: count() }).from(storeCategory);
	if (total > 0) {
		console.log("  ⏭ Store categories already seeded, skipping");
		return;
	}

	console.log("  🏷️ Seeding store categories...");
	await db
		.insert(storeCategory)
		.values(storeCategories.map((name) => ({ name })));
	console.log(`     ✓ ${storeCategories.length} store categories`);
}

export async function seedProductCategories() {
	const [{ total }] = await db.select({ total: count() }).from(productCategory);
	if (total > 0) {
		console.log("  ⏭ Product categories already seeded, skipping");
		return;
	}

	console.log("  🏷️ Seeding product categories...");
	await db
		.insert(productCategory)
		.values(productCategories.map((name) => ({ name })));
	console.log(`     ✓ ${productCategories.length} product categories`);
}
