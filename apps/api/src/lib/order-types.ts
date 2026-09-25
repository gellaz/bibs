import { sql } from "drizzle-orm";

/** Tipi d'ordine che un negozio può offrire al checkout (colonna stores.order_types). */
export const storeOrderTypes = ["reserve_pickup", "pay_pickup"] as const;
export type StoreOrderType = (typeof storeOrderTypes)[number];

// Il pagamento del cliente (PaymentIntent, trasferimenti) arriva con la PR F.
// Fino ad allora un negozio può avere PR2 acceso e il conto abilitato, ma il
// checkout non lo offre: nessun ordine pay_pickup senza un modo di pagarlo.
export const ONLINE_PAYMENT_LIVE = false;

/**
 * Unica regola su cosa si offre al checkout: la usano il carrello (per mostrare
 * la scelta), il checkout (per validarla) e il seller (per mostrare cosa vede il
 * cliente), così non possono divergere. `live` esiste per i test.
 */
export function offeredOrderTypes(
	configured: readonly string[],
	opts: { chargesEnabled: boolean; live?: boolean },
): StoreOrderType[] {
	const online = (opts.live ?? ONLINE_PAYMENT_LIVE) && opts.chargesEnabled;
	return storeOrderTypes.filter(
		(t) => configured.includes(t) && (t !== "pay_pickup" || online),
	);
}

/**
 * Campo SELECT: il seller del negozio può incassare online. Nomi letterali
 * qualificati: come campo SELECT le Column interpolate perdono la tabella.
 * Richiede `stores` nel FROM.
 */
export const sellerChargesEnabledSql = sql<boolean>`COALESCE((
  SELECT pm.charges_enabled FROM payment_methods pm
  WHERE pm.seller_profile_id = stores.seller_profile_id AND pm.is_default
), false)`.as("seller_charges_enabled");
