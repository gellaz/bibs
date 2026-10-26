import { sql } from "drizzle-orm";

/** Tipi d'ordine che un negozio può offrire al checkout (colonna stores.order_types). */
export const storeOrderTypes = ["reserve_pickup", "pay_pickup"] as const;
export type StoreOrderType = (typeof storeOrderTypes)[number];

/**
 * Unica regola su cosa si offre al checkout: la usano il carrello (per mostrare
 * la scelta), il checkout (per validarla) e il seller (per mostrare cosa vede il
 * cliente), così non possono divergere. PR2 richiede il conto Connect abilitato
 * a ricevere i trasferimenti. Con un cambio partita IVA in attesa il venditore
 * non offre niente: gli ordini restano bloccati finché l'admin non decide.
 */
export function offeredOrderTypes(
	configured: readonly string[],
	opts: { chargesEnabled: boolean; vatChangeBlocked: boolean },
): StoreOrderType[] {
	if (opts.vatChangeBlocked) return [];
	return storeOrderTypes.filter(
		(t) =>
			configured.includes(t) && (t !== "pay_pickup" || opts.chargesEnabled),
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

/** Campo SELECT: il venditore ha un cambio partita IVA in attesa. Stesse regole di sellerChargesEnabledSql. */
export const sellerVatChangeBlockedSql = sql<boolean>`(
  SELECT sp.vat_change_blocked FROM seller_profiles sp
  WHERE sp.id = stores.seller_profile_id
)`.as("seller_vat_change_blocked");
