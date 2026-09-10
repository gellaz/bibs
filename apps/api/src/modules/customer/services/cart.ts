import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cartItem, MAX_CART_ITEM_QUANTITY } from "@/db/schemas/cart";
import { municipality, province } from "@/db/schemas/location";
import { product, storeProduct } from "@/db/schemas/product";
import { store } from "@/db/schemas/store";
import { ServiceError } from "@/lib/errors";
import { fromCents, toCents } from "@/lib/money";
import { publiclyVisibleStore } from "@/lib/store-visibility";
import { getBestActiveDiscounts } from "@/modules/seller/services/discount-pricing";

interface AddCartItemParams {
	customerProfileId: string;
	storeProductId: string;
	quantity: number;
}

/**
 * Aggiunge un prodotto al carrello, sommando se la riga esiste già.
 *
 * Il carrello NON riserva stock: lo decrementa `createOrder`, in transazione.
 * Qui lo stock è solo un tetto, così il cliente non accumula un'intenzione che
 * non potrà mai diventare un ordine.
 */
export async function addCartItem(
	params: AddCartItemParams,
): Promise<{ id: string; quantity: number }> {
	const { customerProfileId, storeProductId, quantity } = params;

	return db.transaction(async (tx) => {
		// publiclyVisibleStore() vive in una .where(): lì Drizzle qualifica le
		// Column correttamente (a differenza di un campo SELECT).
		const [sellable] = await tx
			.select({ stock: storeProduct.stock, status: product.status })
			.from(storeProduct)
			.innerJoin(product, eq(product.id, storeProduct.productId))
			.innerJoin(store, eq(store.id, storeProduct.storeId))
			.where(and(eq(storeProduct.id, storeProductId), publiclyVisibleStore()))
			.limit(1);

		// Un prodotto non acquistabile e un prodotto inesistente collassano nello
		// stesso 404: non si conferma l'esistenza di righe che non si possono
		// comprare.
		if (!sellable || sellable.status !== "active")
			throw new ServiceError(404, "Prodotto non disponibile");

		// Tetto effettivo: il minore fra il limite per riga e ciò che il negozio
		// ha davvero. Lo stock qui è un tetto, non una prenotazione — il
		// decremento resta in createOrder.
		const ceiling = Math.min(MAX_CART_ITEM_QUANTITY, sellable.stock);

		const limitError = () =>
			new ServiceError(
				400,
				sellable.stock < MAX_CART_ITEM_QUANTITY
					? sellable.stock === 0
						? "Questo prodotto è esaurito"
						: `Ne restano solo ${sellable.stock}`
					: `Puoi aggiungere al massimo ${MAX_CART_ITEM_QUANTITY} pezzi per prodotto`,
			);

		// La quantità richiesta da sola non può superare il tetto: copre la prima
		// aggiunta, dove non c'è conflitto e la setWhere qui sotto non si applica.
		if (quantity > ceiling) throw limitError();

		// Upsert atomico. L'incremento avviene DENTRO il database, quindi due
		// aggiunte simultanee si sommano invece di sovrascriversi — il
		// read-then-write che c'era prima perdeva l'aggiunta del perdente, in
		// silenzio. La setWhere fa sì che il superamento del tetto non aggiorni
		// nulla: RETURNING torna vuoto, ed è così che lo riconosciamo.
		const [row] = await tx
			.insert(cartItem)
			.values({ customerProfileId, storeProductId, quantity })
			.onConflictDoUpdate({
				target: [cartItem.customerProfileId, cartItem.storeProductId],
				set: {
					quantity: sql`${cartItem.quantity} + ${quantity}`,
					updatedAt: new Date(),
				},
				setWhere: sql`${cartItem.quantity} + ${quantity} <= ${ceiling}`,
			})
			.returning({ id: cartItem.id, quantity: cartItem.quantity });

		if (!row) throw limitError();

		return row;
	});
}

/** Perché una riga non è (del tutto) acquistabile. `ok` = nessun problema. */
export type CartItemIssue = "ok" | "insufficient_stock" | "unavailable";

export interface CartItemView {
	id: string;
	storeProductId: string;
	quantity: number;
	product: { id: string; name: string; imageUrl: string | null };
	unitPrice: string;
	discountedPrice: string | null;
	discountPercent: number | null;
	lineTotal: string;
	availableStock: number;
	issue: CartItemIssue;
}

export interface CartStoreGroup {
	store: {
		id: string;
		name: string;
		municipality: { name: string; provinceAcronym: string };
	};
	items: CartItemView[];
	subtotal: string;
}

export interface CartView {
	groups: CartStoreGroup[];
	itemCount: number;
	total: string;
}

/**
 * Il carrello del cliente, già raggruppato per negozio.
 *
 * Non fallisce mai per righe diventate problematiche: le annota con `issue` e
 * `availableStock` e lascia decidere al cliente. I prezzi si rileggono qui a
 * ogni chiamata — nessuno snapshot — così il carrello dice la stessa cosa che
 * dirà `createOrder` al checkout.
 */
export async function getCart(customerProfileId: string): Promise<CartView> {
	const rows = await db
		.select({
			id: cartItem.id,
			quantity: cartItem.quantity,
			storeProductId: storeProduct.id,
			stock: storeProduct.stock,
			productId: product.id,
			productName: product.name,
			productStatus: product.status,
			price: product.price,
			storeId: store.id,
			storeName: store.name,
			municipalityName: municipality.name,
			provinceAcronym: province.acronym,
			// publiclyVisibleStore() NON è usabile qui: è scritto per una .where(),
			// e come campo SELECT le sue Column interpolate perderebbero la
			// qualificazione — con sei tabelle in join "id" sarebbe ambiguo. Stessa
			// condizione, riscritta con nomi letterali qualificati e alias interno.
			storeVisible: sql<boolean>`(
        stores.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM store_subscriptions ss
          WHERE ss.store_id = stores.id
          AND ss.status IN ('active', 'past_due', 'canceling')
        )
      )`.as("store_visible"),
			imageUrl: sql<string | null>`(
        SELECT pi.url FROM product_images pi
        WHERE pi.product_id = products.id
        ORDER BY pi.position ASC
        LIMIT 1
      )`.as("image_url"),
		})
		.from(cartItem)
		.innerJoin(storeProduct, eq(storeProduct.id, cartItem.storeProductId))
		.innerJoin(product, eq(product.id, storeProduct.productId))
		.innerJoin(store, eq(store.id, storeProduct.storeId))
		.innerJoin(municipality, eq(municipality.id, store.municipalityId))
		.innerJoin(province, eq(province.id, municipality.provinceId))
		.where(eq(cartItem.customerProfileId, customerProfileId))
		.orderBy(store.name, store.id, cartItem.createdAt);

	if (rows.length === 0) return { groups: [], itemCount: 0, total: "0.00" };

	// Batch: una query per tutti i prodotti del carrello. `ActiveDiscountInfo`
	// porta anche `endsAt: Date`, che NON deve finire nel DTO — qui si leggono
	// solo `percent` e `discountedPrice`.
	const discountMap = await getBestActiveDiscounts([
		...new Set(rows.map((r) => r.productId)),
	]);

	const groups = new Map<string, CartStoreGroup>();
	let totalCents = 0;
	let itemCount = 0;

	for (const row of rows) {
		const discount = discountMap.get(row.productId);
		const lineCents =
			toCents(discount?.discountedPrice ?? row.price) * row.quantity;

		const issue: CartItemIssue =
			!row.storeVisible || row.productStatus !== "active"
				? "unavailable"
				: row.stock < row.quantity
					? "insufficient_stock"
					: "ok";

		let group = groups.get(row.storeId);
		if (!group) {
			group = {
				store: {
					id: row.storeId,
					name: row.storeName,
					municipality: {
						name: row.municipalityName,
						provinceAcronym: row.provinceAcronym,
					},
				},
				items: [],
				subtotal: "0.00",
			};
			groups.set(row.storeId, group);
		}

		group.items.push({
			id: row.id,
			storeProductId: row.storeProductId,
			quantity: row.quantity,
			product: {
				id: row.productId,
				name: row.productName,
				imageUrl: row.imageUrl,
			},
			unitPrice: row.price,
			discountedPrice: discount?.discountedPrice ?? null,
			discountPercent: discount?.percent ?? null,
			lineTotal: fromCents(lineCents),
			availableStock: row.stock,
			issue,
		});

		// itemCount conta tutto ciò che è nel carrello, problemi inclusi: il badge
		// dice "quanta roba c'è", e le righe rotte vogliono comunque attenzione.
		itemCount += row.quantity;

		// I totali invece escludono le righe non acquistabili: gonfierebbero una
		// cifra che il cliente non pagherà mai.
		if (issue !== "unavailable") {
			group.subtotal = fromCents(toCents(group.subtotal) + lineCents);
			totalCents += lineCents;
		}
	}

	return {
		groups: [...groups.values()],
		itemCount,
		total: fromCents(totalCents),
	};
}
