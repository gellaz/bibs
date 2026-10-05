import { m } from "@/paraglide/messages";

export interface PricingFields {
	fee: string;
	days: string;
	hours: string;
	productId: string;
}

export interface PricingValue {
	storeMonthlyFeeCents: number;
	suspendedAutoCancelDays: number;
	pendingCreationExpiryHours: number;
	productId: string;
}

export const EMPTY_PRICING_FIELDS: PricingFields = {
	fee: "",
	days: "",
	hours: "",
	productId: "",
};

/** Whole number within [min, max], or null. Rejects "", "2.5", "1e3". */
function parseWhole(raw: string, min: number, max: number): number | null {
	if (!/^\d+$/.test(raw.trim())) return null;
	const n = Number(raw);
	return n >= min && n <= max ? n : null;
}

/**
 * The dialog keeps what the admin typed (strings) and turns it into numbers
 * only here, with the same bounds the API enforces — so an emptied field is
 * an error message, never a NaN in the request.
 */
export function parsePricingForm(
	f: PricingFields,
):
	| { value: PricingValue }
	| { errors: Partial<Record<keyof PricingFields, string>> } {
	const errors: Partial<Record<keyof PricingFields, string>> = {};

	// Euro and cents, at most two decimals: no silent rounding of a price.
	const feeRaw = f.fee.trim().replace(",", ".");
	const feeCents = /^\d+(\.\d{1,2})?$/.test(feeRaw)
		? Math.round(Number(feeRaw) * 100)
		: Number.NaN;
	if (!(feeCents >= 100)) errors.fee = m.billing_pricing_fee_invalid();

	const days = parseWhole(f.days, 7, 365);
	if (days === null) errors.days = m.billing_pricing_days_invalid();

	const hours = parseWhole(f.hours, 1, 168);
	if (hours === null) errors.hours = m.billing_pricing_hours_invalid();

	const productId = f.productId.trim();
	if (!/^prod_[A-Za-z0-9]+$/.test(productId))
		errors.productId = m.billing_pricing_product_invalid();

	if (Object.keys(errors).length > 0 || days === null || hours === null)
		return { errors };
	return {
		value: {
			storeMonthlyFeeCents: feeCents,
			suspendedAutoCancelDays: days,
			pendingCreationExpiryHours: hours,
			productId,
		},
	};
}

/** «1 ora» / «24 ore»: la scadenza dei checkout pending nella lingua corrente. */
export function expiryHoursLabel(count: number): string {
	return count === 1
		? m.billing_pricing_hours_one({ count })
		: m.billing_pricing_hours({ count });
}
