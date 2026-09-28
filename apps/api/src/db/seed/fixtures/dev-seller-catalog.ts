import { and, asc, eq, gt, inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schemas/auth";
import { brand } from "@/db/schemas/brand";
import { productCategory } from "@/db/schemas/category";
import { customerProfile } from "@/db/schemas/customer";
import { discount, discountProduct } from "@/db/schemas/discount";
import { order } from "@/db/schemas/order";
import { product, storeProduct } from "@/db/schemas/product";
import { productImage } from "@/db/schemas/product-image";
import { sellerProfile } from "@/db/schemas/seller";
import { store } from "@/db/schemas/store";
import { storeCategory } from "@/db/schemas/store-category";
import { expireReservations } from "@/lib/jobs/expire-reservations";
import { cancelOrder, createOrder } from "@/modules/customer/services/orders";
import { transitionOrder } from "@/modules/seller/services/orders";

const DEV_EMAIL = "seller@dev.bibs";
const MAIN_STORE = "Bottega Dev";
const CENTRO_STORE = "Bottega Dev Centro";
// Fuori dal range di genEan13 (8000000000000 + indice globale) usato dagli
// altri venditori: nessuna collisione anche se il catalogo generato cresce.
const EAN_BASE = 8099000000000n;
const DAY = 86_400_000;

type Vat = "4" | "10" | "22";

interface DevProduct {
	name: string;
	description: string;
	category: string;
	price: string;
	vat: Vat;
	brand?: "pastificio" | "torrefazione";
	/** Stock in Bottega Dev; assente = non venduto lì. */
	main?: number;
	/** Stock in Bottega Dev Centro; assente = non venduto lì. */
	centro?: number;
	status?: "active" | "disabled";
}

/**
 * Catalogo da bottega alimentare, scritto a mano per gli smoke test: aliquote
 * miste (castelletto), stock normale / basso / esaurito, un prodotto
 * disattivato, prodotti condivisi ed esclusivi tra i due negozi (checkout
 * multi-negozio).
 */
const CATALOG: DevProduct[] = [
	{
		name: "Spaghetti di grano duro 500 g",
		description: "Trafilati al bronzo, essiccazione lenta.",
		category: "Pasta",
		price: "1.20",
		vat: "4",
		brand: "pastificio",
		main: 40,
		centro: 25,
	},
	{
		name: "Penne rigate 500 g",
		description: "Trafilate al bronzo, tengono bene il sugo.",
		category: "Pasta",
		price: "1.20",
		vat: "4",
		brand: "pastificio",
		main: 35,
		centro: 20,
	},
	{
		name: "Tagliatelle all'uovo 250 g",
		description: "Sfoglia tirata con uova da allevamento a terra.",
		category: "Pasta",
		price: "2.80",
		vat: "4",
		brand: "pastificio",
		main: 18,
	},
	{
		name: "Riso Carnaroli 1 kg",
		description: "Il riso da risotto per eccellenza, dal Pavese.",
		category: "Riso",
		price: "4.90",
		vat: "4",
		main: 22,
		centro: 10,
	},
	{
		name: "Riso Arborio 1 kg",
		description: "Chicco grosso, ideale per risotti cremosi.",
		category: "Riso",
		price: "3.90",
		vat: "4",
		main: 2,
	},
	{
		name: "Passata di pomodoro 700 g",
		description: "Solo pomodoro italiano e un pizzico di sale.",
		category: "Conserve",
		price: "1.60",
		vat: "4",
		main: 30,
		centro: 15,
	},
	{
		name: "Olio extravergine d'oliva 750 ml",
		description: "Spremitura a freddo, raccolta dell'anno.",
		category: "Conserve",
		price: "12.90",
		vat: "4",
		main: 15,
		centro: 5,
	},
	{
		name: "Pesto alla genovese 190 g",
		description: "Basilico ligure, pinoli e Parmigiano.",
		category: "Conserve",
		price: "3.90",
		vat: "10",
		main: 12,
		centro: 6,
	},
	{
		name: "Carciofini sott'olio 280 g",
		description: "Carciofini interi in olio di semi di girasole.",
		category: "Conserve",
		price: "5.50",
		vat: "10",
		main: 0,
		centro: 8,
	},
	{
		name: "Caffè macinato per moka 250 g",
		description: "Miscela 80% arabica, tostatura media.",
		category: "Caffè",
		price: "4.50",
		vat: "22",
		brand: "torrefazione",
		main: 25,
		centro: 12,
	},
	{
		name: "Caffè in grani 1 kg",
		description: "Miscela per espresso, tostatura scura.",
		category: "Caffè",
		price: "18.90",
		vat: "22",
		brand: "torrefazione",
		main: 8,
	},
	{
		name: "Tè verde sencha, 50 filtri",
		description: "Tè verde giapponese dal gusto erbaceo.",
		category: "Tè",
		price: "3.20",
		vat: "10",
		main: 10,
	},
	{
		name: "Biscotti di frolla 350 g",
		description: "Con burro fresco, senza olio di palma.",
		category: "Dolci",
		price: "3.40",
		vat: "10",
		main: 20,
		centro: 10,
	},
	{
		name: "Panettone artigianale 1 kg",
		description: "Lievitazione naturale di 36 ore.",
		category: "Dolci",
		price: "24.90",
		vat: "10",
		main: 6,
		centro: 3,
	},
	{
		name: "Cioccolato fondente 70% 100 g",
		description: "Cacao da filiera tracciata.",
		category: "Dolci",
		price: "2.50",
		vat: "10",
		main: 30,
	},
	{
		name: "Taralli all'olio 250 g",
		description: "Ricetta pugliese, cotti in forno.",
		category: "Snack",
		price: "2.20",
		vat: "10",
		main: 25,
		centro: 12,
	},
	{
		name: "Grissini torinesi 250 g",
		description: "Stirati a mano.",
		category: "Snack",
		price: "2.40",
		vat: "10",
		main: 10,
		status: "disabled",
	},
	{
		name: "Acqua minerale frizzante 6 × 1,5 l",
		description: "Confezione da sei bottiglie.",
		category: "Bevande analcoliche",
		price: "3.60",
		vat: "22",
		main: 20,
	},
	{
		name: "Succo di mela bio 1 l",
		description: "Mele biologiche dell'Alto Adige, non filtrato.",
		category: "Succhi",
		price: "2.90",
		vat: "22",
		main: 14,
		centro: 6,
	},
	{
		name: "Moka 3 tazze",
		description: "Alluminio, adatta a tutti i fornelli tranne induzione.",
		category: "Macchine caffè",
		price: "29.90",
		vat: "22",
		main: 4,
	},
	{
		name: "Tagliere in legno d'ulivo",
		description: "Pezzo unico, 35 × 20 cm.",
		category: "Utensili cucina",
		price: "39.90",
		vat: "22",
		main: 3,
	},
	{
		name: "Gallette di riso bio 130 g",
		description: "Solo riso integrale biologico.",
		category: "Prodotti bio",
		price: "1.90",
		vat: "4",
		centro: 15,
	},
	{
		name: "Fusilli senza glutine 400 g",
		description: "Mais e riso, prodotti in stabilimento dedicato.",
		category: "Senza glutine",
		price: "2.60",
		vat: "4",
		centro: 10,
	},
];

const BRANDS = {
	pastificio: "Pastificio Navigli",
	torrefazione: "Torrefazione Porta Romana",
} as const;

const STORE_PROFILES: Record<
	string,
	{ category: string; description: string }
> = {
	[MAIN_STORE]: {
		category: "Alimentari",
		description:
			"Bottega di quartiere con pasta di piccoli pastifici, conserve, caffè tostato in città e qualche oggetto per la cucina. Prenoti online e ritiri al banco, oppure paghi subito e passi a prendere.",
	},
	[CENTRO_STORE]: {
		category: "Gastronomia",
		description:
			"Il secondo punto vendita, in centro: una selezione più piccola del catalogo, con qualche prodotto bio e senza glutine che trovi solo qui.",
	},
};

/**
 * Catalogo, promozioni e ordini del venditore di sviluppo (seller@dev.bibs),
 * che il seed generato lascia vuoto. Idempotente: salta se il catalogo c'è già
 * (riconosciuto dagli EAN del seed, non dal numero di prodotti: quelli creati a
 * mano durante uno smoke non contano). Non dipende dallo skip di seedDevSeller,
 * così `db:seed` su un DB esistente aggiunge il catalogo senza reset.
 */
export async function seedDevSellerCatalog() {
	const [seller] = await db
		.select({ sellerProfileId: sellerProfile.id })
		.from(sellerProfile)
		.innerJoin(user, eq(user.id, sellerProfile.userId))
		.where(eq(user.email, DEV_EMAIL))
		.limit(1);
	if (!seller) {
		console.log(`  ⏭ ${DEV_EMAIL} assente, niente catalogo dev`);
		return;
	}
	const { sellerProfileId } = seller;

	const firstEan = (EAN_BASE + 1n).toString();
	const already = await db.query.product.findFirst({
		where: and(
			eq(product.sellerProfileId, sellerProfileId),
			eq(product.ean, firstEan),
		),
		columns: { id: true },
	});
	if (already) {
		console.log("  ⏭ Catalogo dev già presente, skipping");
		return;
	}

	const stores = await db
		.select({ id: store.id, name: store.name })
		.from(store)
		.where(
			and(
				eq(store.sellerProfileId, sellerProfileId),
				inArray(store.name, [MAIN_STORE, CENTRO_STORE]),
			),
		);
	const storeIdByName = new Map(stores.map((s) => [s.name, s.id]));
	const mainId = storeIdByName.get(MAIN_STORE);
	const centroId = storeIdByName.get(CENTRO_STORE);
	if (!mainId || !centroId)
		throw new Error(
			`seedDevSellerCatalog: negozi "${MAIN_STORE}" e "${CENTRO_STORE}" attesi per ${DEV_EMAIL}`,
		);

	// ── Categorie ─────────────────────────────────────────
	const wantedCategories = [...new Set(CATALOG.map((p) => p.category))];
	const categoryRows = await db
		.select({ id: productCategory.id, name: productCategory.name })
		.from(productCategory)
		.where(inArray(productCategory.name, wantedCategories));
	const categoryIdByName = new Map(categoryRows.map((c) => [c.name, c.id]));
	const missing = wantedCategories.filter((n) => !categoryIdByName.has(n));
	if (missing.length > 0)
		throw new Error(
			`seedDevSellerCatalog: categorie prodotto assenti: ${missing.join(", ")}. Hai eseguito il seed base?`,
		);

	const storeCategoryRows = await db
		.select({ id: storeCategory.id, name: storeCategory.name })
		.from(storeCategory)
		.where(
			inArray(
				storeCategory.name,
				Object.values(STORE_PROFILES).map((p) => p.category),
			),
		);
	const storeCategoryIdByName = new Map(
		storeCategoryRows.map((c) => [c.name, c.id]),
	);

	console.log(`  🧺 Seeding catalogo dev (${CATALOG.length} prodotti)...`);

	// ── Profilo dei negozi ────────────────────────────────
	// Entrambi configurano anche «Paga e ritira»: si offre ai clienti solo col
	// conto Connect abilitato, che un seed non può creare (onboarding Stripe).
	for (const [name, profile] of Object.entries(STORE_PROFILES)) {
		const categoryId = storeCategoryIdByName.get(profile.category);
		if (!categoryId)
			throw new Error(
				`seedDevSellerCatalog: categoria negozio "${profile.category}" assente`,
			);
		await db
			.update(store)
			.set({
				categoryId,
				description: profile.description,
				orderTypes: ["reserve_pickup", "pay_pickup"],
			})
			.where(eq(store.id, storeIdByName.get(name) as string));
	}

	// ── Brand ─────────────────────────────────────────────
	const brandRows = await db
		.insert(brand)
		.values(Object.values(BRANDS).map((name) => ({ sellerProfileId, name })))
		.onConflictDoNothing()
		.returning({ id: brand.id, name: brand.name });
	const existingBrands =
		brandRows.length === Object.keys(BRANDS).length
			? brandRows
			: await db
					.select({ id: brand.id, name: brand.name })
					.from(brand)
					.where(
						and(
							eq(brand.sellerProfileId, sellerProfileId),
							inArray(brand.name, Object.values(BRANDS)),
						),
					);
	const brandIdByName = new Map(existingBrands.map((b) => [b.name, b.id]));

	// ── Prodotti, inventario, immagini ────────────────────
	const inserted = await db
		.insert(product)
		.values(
			CATALOG.map((p, i) => ({
				sellerProfileId,
				name: p.name,
				description: p.description,
				ean: (EAN_BASE + BigInt(i + 1)).toString(),
				brandId: p.brand ? (brandIdByName.get(BRANDS[p.brand]) ?? null) : null,
				productCategoryId: categoryIdByName.get(p.category) ?? null,
				price: p.price,
				vatRate: p.vat,
				status: p.status ?? "active",
			})),
		)
		.returning({ id: product.id });
	const productIds = inserted.map((r) => r.id);

	const inventory = CATALOG.flatMap((p, i) => [
		...(p.main !== undefined
			? [{ productId: productIds[i], storeId: mainId, stock: p.main }]
			: []),
		...(p.centro !== undefined
			? [{ productId: productIds[i], storeId: centroId, stock: p.centro }]
			: []),
	]);
	await db.insert(storeProduct).values(inventory);

	await db.insert(productImage).values(
		CATALOG.flatMap((p, i) =>
			p.status === "disabled"
				? []
				: [
						{
							productId: productIds[i],
							url: `https://picsum.photos/seed/${productIds[i]}/600/600`,
							key: `picsum-${productIds[i]}-0`,
							position: 0,
						},
					],
		),
	);

	// ── Promozioni: attiva, programmata, scaduta ──────────
	const byCategory = (category: string) =>
		CATALOG.flatMap((p, i) =>
			p.category === category && p.status !== "disabled" ? [productIds[i]] : [],
		);
	const now = Date.now();
	const promos = [
		{
			title: "Settimana della pasta",
			percent: 15,
			startsAt: new Date(now - 2 * DAY),
			endsAt: new Date(now + 5 * DAY),
			productIds: byCategory("Pasta"),
		},
		{
			title: "Natale in bottega",
			percent: 20,
			startsAt: new Date(now + 10 * DAY),
			endsAt: new Date(now + 30 * DAY),
			productIds: byCategory("Dolci"),
		},
		{
			title: "Promo caffè",
			percent: 10,
			startsAt: new Date(now - 30 * DAY),
			endsAt: new Date(now - 10 * DAY),
			productIds: byCategory("Caffè"),
		},
	];
	for (const promo of promos) {
		const [row] = await db
			.insert(discount)
			.values({
				sellerProfileId,
				title: promo.title,
				percent: promo.percent,
				startsAt: promo.startsAt,
				endsAt: promo.endsAt,
				status: "active",
			})
			.returning({ id: discount.id });
		await db.insert(discountProduct).values(
			promo.productIds.map((productId) => ({
				discountId: row.id,
				productId,
			})),
		);
	}

	const orderCount = await seedDevOrders(mainId, sellerProfileId);

	console.log(
		`  ✓ Catalogo dev: ${productIds.length} prodotti, ${inventory.length} righe di inventario, ${promos.length} promozioni, ${orderCount} ordini`,
	);
}

type OrderEnd =
	| "confirmed"
	| "ready_for_pickup"
	| "completed"
	| "cancelled"
	| "expired";
// Solo prenotazioni (PP1): un «Paga e ritira» seedato non ha un PaymentIntent
// e non si potrebbe annullare con rimborso. I PR2 si creano dal checkout.
const DEV_ORDER_ENDS: OrderEnd[] = [
	"confirmed",
	"confirmed",
	"ready_for_pickup",
	"completed",
	"cancelled",
	"expired",
];

// Gira solo alla prima semina del catalogo (seedDevSellerCatalog è idempotente).
async function seedDevOrders(storeId: string, sellerProfileId: string) {
	const items = await db
		.select({ id: storeProduct.id })
		.from(storeProduct)
		.innerJoin(product, eq(product.id, storeProduct.productId))
		.where(
			and(
				eq(storeProduct.storeId, storeId),
				eq(product.status, "active"),
				// Scorte basse ed esaurite restano intatte per lo smoke.
				gt(storeProduct.stock, 5),
			),
		)
		.orderBy(asc(product.ean));
	const buyable = items.slice(0, 8);

	const customers = await db
		.select({ id: customerProfile.id })
		.from(customerProfile)
		.innerJoin(user, eq(user.id, customerProfile.userId))
		.where(like(user.email, "customer%@test.com"))
		.orderBy(asc(user.email))
		.limit(DEV_ORDER_ENDS.length);
	if (customers.length === 0 || buyable.length < 3) return 0;

	for (const [i, end] of DEV_ORDER_ENDS.entries()) {
		const customerProfileId = customers[i % customers.length].id;
		const lineCount = (i % 3) + 1;
		const created = await createOrder({
			customerProfileId,
			customerPoints: 0,
			type: "reserve_pickup",
			storeId,
			items: Array.from({ length: lineCount }, (_, k) => ({
				storeProductId: buyable[(i * 3 + k) % buyable.length].id,
				quantity: (k % 2) + 1,
			})),
		});
		const storeIds = [storeId];
		if (end === "ready_for_pickup" || end === "completed")
			await transitionOrder(
				created.id,
				sellerProfileId,
				"ready_for_pickup",
				storeIds,
			);
		if (end === "completed")
			await transitionOrder(created.id, sellerProfileId, "completed", storeIds);
		if (end === "cancelled")
			await cancelOrder({ orderId: created.id, customerProfileId });
		if (end === "expired") {
			await db
				.update(order)
				.set({ reservationExpiresAt: new Date(Date.now() - 60_000) })
				.where(eq(order.id, created.id));
			await expireReservations();
		}
	}
	return DEV_ORDER_ENDS.length;
}
