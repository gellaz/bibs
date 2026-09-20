import type { Coords } from "./coords";

/** La chiave in `localStorage`. Solo la scelta: le coordinate scadono, un id no. */
export const STORAGE_KEY = "bibs-customer-search-origin";

/** Quello che persistiamo: un puntatore, non una posizione. */
export type StoredChoice =
	| { kind: "gps" }
	| { kind: "address"; addressId: string }
	| { kind: "none" };

/**
 * L'origine effettiva di una ricerca. `gps` può avere `coords: null` — permesso
 * non ancora concesso, o lettura fallita: la UI lo dice, e le query partono
 * senza filtro geografico invece di fingere una posizione.
 */
export type SearchOrigin =
	| { kind: "gps"; coords: Coords | null }
	| { kind: "address"; addressId: string; label: string; coords: Coords }
	| { kind: "none" };

/**
 * La parte di un indirizzo che serve qui. Strutturale di proposito: il tipo
 * Eden di `useAddresses` la soddisfa per forma, e il dominio resta testabile
 * senza il client API (stesso patto di `features/addresses/address-form-state.ts`).
 */
export interface OriginAddress {
	id: string;
	label: string | null;
	addressLine1: string;
	isDefault: boolean;
	location: { x: number; y: number } | null;
}

export function parseStoredChoice(raw: string | null): StoredChoice | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return null;
		const { kind, addressId } = parsed as {
			kind?: unknown;
			addressId?: unknown;
		};
		if (kind === "gps") return { kind: "gps" };
		if (kind === "none") return { kind: "none" };
		if (kind === "address" && typeof addressId === "string" && addressId) {
			return { kind: "address", addressId };
		}
		return null;
	} catch {
		return null;
	}
}

export function serializeChoice(choice: StoredChoice): string {
	return JSON.stringify(choice);
}

/** Come la rubrica intitola una card: l'etichetta se c'è, altrimenti la via. */
export function addressOriginLabel(address: OriginAddress): string {
	return address.label?.trim() || address.addressLine1;
}

/** Senza coordinate un indirizzo non è un'origine, per quanto sia salvato. */
function hasPosition(address: OriginAddress): boolean {
	return address.location !== null;
}

export function findOriginAddress(
	addresses: OriginAddress[],
	addressId: string,
): OriginAddress | null {
	return addresses.find((a) => a.id === addressId && hasPosition(a)) ?? null;
}

export function defaultOriginAddress(
	addresses: OriginAddress[],
): OriginAddress | null {
	return addresses.find((a) => a.isDefault && hasPosition(a)) ?? null;
}

interface BootContext {
	stored: StoredChoice | null;
	addresses: OriginAddress[];
	/** Il GPS è riprendibile solo se il consenso c'è già: niente prompt d'ufficio. */
	gpsUsable: boolean;
}

/**
 * Con cosa parte l'app: l'ultima scelta se regge ancora, altrimenti
 * l'indirizzo predefinito, altrimenti nessuna origine.
 */
export function bootChoice({
	stored,
	addresses,
	gpsUsable,
}: BootContext): StoredChoice {
	if (stored?.kind === "none") return { kind: "none" };
	if (stored?.kind === "gps" && gpsUsable) return { kind: "gps" };
	if (stored?.kind === "address") {
		const found = findOriginAddress(addresses, stored.addressId);
		if (found) return { kind: "address", addressId: found.id };
	}
	const fallback = defaultOriginAddress(addresses);
	return fallback
		? { kind: "address", addressId: fallback.id }
		: { kind: "none" };
}

interface OriginContext {
	addresses: OriginAddress[];
	gpsCoords: Coords | null;
}

/**
 * La scelta diventa origine. Rivalutata a ogni render perché entrambi gli
 * ingressi cambiano sotto: le coordinate GPS arrivano in ritardo, e la rubrica
 * può perdere l'indirizzo scelto mentre lo si sta usando.
 */
export function originFromChoice(
	choice: StoredChoice | null,
	{ addresses, gpsCoords }: OriginContext,
): SearchOrigin {
	if (!choice || choice.kind === "none") return { kind: "none" };
	if (choice.kind === "gps") return { kind: "gps", coords: gpsCoords };

	const address =
		findOriginAddress(addresses, choice.addressId) ??
		defaultOriginAddress(addresses);
	if (!address?.location) return { kind: "none" };

	return {
		kind: "address",
		addressId: address.id,
		label: addressOriginLabel(address),
		// `x` è la longitudine e `y` la latitudine (PointXY dell'API).
		coords: { lat: address.location.y, lng: address.location.x },
	};
}

/** Il `near` dell'URL: un puntatore opaco, mai una coordinata. */
export function nearFromOrigin(origin: SearchOrigin): string | undefined {
	if (origin.kind === "gps") return "gps";
	if (origin.kind === "address") return origin.addressId;
	return undefined;
}

export function choiceFromNear(near: string): StoredChoice {
	return near === "gps"
		? { kind: "gps" }
		: { kind: "address", addressId: near };
}
