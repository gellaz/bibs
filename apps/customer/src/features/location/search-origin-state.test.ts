import { describe, expect, it } from "bun:test";
import {
	addressOriginLabel,
	bootChoice,
	choiceFromNear,
	defaultOriginAddress,
	findOriginAddress,
	nearFromOrigin,
	originFromChoice,
	parseStoredChoice,
	serializeChoice,
} from "./search-origin-state";

const CASA = {
	id: "a-casa",
	label: "Casa",
	addressLine1: "Via Roma 12",
	isDefault: true,
	location: { x: 9.19, y: 45.4642 },
};

const LAVORO = {
	id: "a-lavoro",
	label: "  ",
	addressLine1: "Corso Buenos Aires 1",
	isDefault: false,
	location: { x: 9.2093, y: 45.4801 },
};

/** Una riga vecchia: l'API ammette `location` nulla, la rubrica no. */
const SENZA_POSIZIONE = {
	id: "a-vecchio",
	label: "Nonna",
	addressLine1: "Via Verdi 3",
	isDefault: false,
	location: null,
};

const MILANO = { lat: 45.4642, lng: 9.19 };

describe("parseStoredChoice", () => {
	it("accetta le tre forme che scriviamo noi", () => {
		expect(parseStoredChoice('{"kind":"gps"}')).toEqual({ kind: "gps" });
		expect(parseStoredChoice('{"kind":"none"}')).toEqual({ kind: "none" });
		expect(
			parseStoredChoice('{"kind":"address","addressId":"a-casa"}'),
		).toEqual({ kind: "address", addressId: "a-casa" });
	});

	// `localStorage` è territorio ostile: ci scrive anche chi non siamo noi, e
	// una vecchia versione dell'app può averci lasciato un'altra forma.
	it("respinge tutto il resto senza esplodere", () => {
		expect(parseStoredChoice(null)).toBeNull();
		expect(parseStoredChoice("")).toBeNull();
		expect(parseStoredChoice("non-json")).toBeNull();
		expect(parseStoredChoice('"gps"')).toBeNull();
		expect(parseStoredChoice('{"kind":"altro"}')).toBeNull();
		expect(parseStoredChoice('{"kind":"address"}')).toBeNull();
		expect(parseStoredChoice('{"kind":"address","addressId":""}')).toBeNull();
	});

	it("rilegge quello che serializza", () => {
		const choice = { kind: "address", addressId: "a-casa" } as const;
		expect(parseStoredChoice(serializeChoice(choice))).toEqual(choice);
	});
});

describe("addressOriginLabel", () => {
	it("usa l'etichetta quando c'è", () => {
		expect(addressOriginLabel(CASA)).toBe("Casa");
	});

	it("ripiega sulla via quando l'etichetta è vuota o solo spazi", () => {
		expect(addressOriginLabel(LAVORO)).toBe("Corso Buenos Aires 1");
	});
});

describe("findOriginAddress / defaultOriginAddress", () => {
	it("trova l'indirizzo per id", () => {
		expect(findOriginAddress([CASA, LAVORO], "a-lavoro")).toBe(LAVORO);
	});

	it("non restituisce un indirizzo senza coordinate: non è un'origine", () => {
		expect(findOriginAddress([SENZA_POSIZIONE], "a-vecchio")).toBeNull();
		expect(
			defaultOriginAddress([{ ...SENZA_POSIZIONE, isDefault: true }]),
		).toBeNull();
	});

	it("il predefinito è quello marcato, non il primo", () => {
		expect(defaultOriginAddress([LAVORO, CASA])).toBe(CASA);
		expect(defaultOriginAddress([LAVORO])).toBeNull();
	});
});

describe("bootChoice", () => {
	it("senza niente in memoria parte dall'indirizzo predefinito", () => {
		expect(
			bootChoice({ stored: null, addresses: [LAVORO, CASA], gpsUsable: false }),
		).toEqual({ kind: "address", addressId: "a-casa" });
	});

	it("senza niente in memoria e senza indirizzi non cerca da nessuna parte", () => {
		expect(
			bootChoice({ stored: null, addresses: [], gpsUsable: true }),
		).toEqual({ kind: "none" });
	});

	it("rispetta l'ultima scelta se l'indirizzo esiste ancora", () => {
		expect(
			bootChoice({
				stored: { kind: "address", addressId: "a-lavoro" },
				addresses: [CASA, LAVORO],
				gpsUsable: false,
			}),
		).toEqual({ kind: "address", addressId: "a-lavoro" });
	});

	// Il caso "indirizzo cancellato mentre era l'origine attiva" della spec.
	it("se l'indirizzo scelto non c'è più cade sul predefinito", () => {
		expect(
			bootChoice({
				stored: { kind: "address", addressId: "sparito" },
				addresses: [CASA, LAVORO],
				gpsUsable: false,
			}),
		).toEqual({ kind: "address", addressId: "a-casa" });
	});

	it("riprende il GPS solo se il permesso c'è già", () => {
		expect(
			bootChoice({
				stored: { kind: "gps" },
				addresses: [CASA],
				gpsUsable: true,
			}),
		).toEqual({ kind: "gps" });
	});

	// Senza consenso non si può chiedere la posizione all'avvio senza far
	// scattare il prompt: si riparte da un indirizzo.
	it("senza consenso il GPS memorizzato ripiega sul predefinito", () => {
		expect(
			bootChoice({
				stored: { kind: "gps" },
				addresses: [CASA],
				gpsUsable: false,
			}),
		).toEqual({ kind: "address", addressId: "a-casa" });
	});

	it('"Tutta l\'Italia" resta una scelta, non un ripiego da correggere', () => {
		expect(
			bootChoice({
				stored: { kind: "none" },
				addresses: [CASA],
				gpsUsable: true,
			}),
		).toEqual({ kind: "none" });
	});
});

describe("originFromChoice", () => {
	it("traduce x/y in lng/lat, non il contrario", () => {
		const origin = originFromChoice(
			{ kind: "address", addressId: "a-casa" },
			{ addresses: [CASA], gpsCoords: null },
		);
		expect(origin).toEqual({
			kind: "address",
			addressId: "a-casa",
			label: "Casa",
			coords: { lat: 45.4642, lng: 9.19 },
		});
	});

	it("il GPS senza coordinate resta GPS: la UI lo dice invece di mentire", () => {
		expect(
			originFromChoice({ kind: "gps" }, { addresses: [CASA], gpsCoords: null }),
		).toEqual({ kind: "gps", coords: null });
		expect(
			originFromChoice({ kind: "gps" }, { addresses: [], gpsCoords: MILANO }),
		).toEqual({ kind: "gps", coords: MILANO });
	});

	it("un indirizzo sparito sotto i piedi cade sul predefinito", () => {
		const origin = originFromChoice(
			{ kind: "address", addressId: "sparito" },
			{ addresses: [CASA], gpsCoords: null },
		);
		expect(origin).toMatchObject({ kind: "address", addressId: "a-casa" });
	});

	it("senza predefinito su cui cadere resta senza origine", () => {
		expect(
			originFromChoice(
				{ kind: "address", addressId: "sparito" },
				{ addresses: [LAVORO], gpsCoords: null },
			),
		).toEqual({ kind: "none" });
	});

	// `null` = provider ancora in avvio: nessuna origine, nessuna query geografica.
	it("senza scelta non c'è origine", () => {
		expect(
			originFromChoice(null, { addresses: [CASA], gpsCoords: MILANO }),
		).toEqual({ kind: "none" });
		expect(
			originFromChoice(
				{ kind: "none" },
				{ addresses: [CASA], gpsCoords: MILANO },
			),
		).toEqual({ kind: "none" });
	});
});

describe("nearFromOrigin / choiceFromNear", () => {
	it("nell'URL finisce un puntatore, mai una coordinata", () => {
		expect(nearFromOrigin({ kind: "gps", coords: MILANO })).toBe("gps");
		expect(
			nearFromOrigin({
				kind: "address",
				addressId: "a-casa",
				label: "Casa",
				coords: MILANO,
			}),
		).toBe("a-casa");
		expect(nearFromOrigin({ kind: "none" })).toBeUndefined();
	});

	it("rilegge il parametro", () => {
		expect(choiceFromNear("gps")).toEqual({ kind: "gps" });
		expect(choiceFromNear("a-casa")).toEqual({
			kind: "address",
			addressId: "a-casa",
		});
	});
});
