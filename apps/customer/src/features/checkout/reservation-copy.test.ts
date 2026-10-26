import { describe, expect, it } from "vitest";
import { closedNoteOpensAt, reserveNoteKind } from "./reservation-copy";

describe("reserveNoteKind", () => {
	it("tutti a ore di apertura → opening", () => {
		expect(reserveNoteKind(["opening", "opening"])).toBe("opening");
	});
	it("misto → mixed", () => {
		expect(reserveNoteKind(["opening", "calendar"])).toBe("mixed");
	});
	it("solo calendario → calendar", () => {
		expect(reserveNoteKind(["calendar"])).toBe("calendar");
	});
});

describe("closedNoteOpensAt", () => {
	// Scadenza mer 21 ott 2026 alle 17:00 di Roma (UTC+2).
	const expiresAt = "2026-10-21T15:00:00.000Z";
	const closed = {
		status: "closed",
		opensAt: { date: "2026-10-19", time: "08:00" },
	};

	it("chiuso, riapre prima della scadenza → la riapertura", () => {
		expect(
			closedNoteOpensAt({ open: true, expiresAt, openStatus: closed }),
		).toEqual({ date: "2026-10-19", time: "08:00" });
	});

	it("opensAt.date già idratato in Date → stesso risultato", () => {
		expect(
			closedNoteOpensAt({
				open: true,
				expiresAt,
				openStatus: {
					status: "closed_holiday",
					opensAt: {
						date: new Date("2026-10-19T00:00:00.000Z"),
						time: "08:00",
					},
				},
			}),
		).toEqual({ date: "2026-10-19", time: "08:00" });
	});

	it("riapre alla scadenza o dopo → null", () => {
		for (const opensAt of [
			{ date: "2026-10-21", time: "17:00" },
			{ date: "2026-10-22", time: "08:00" },
		])
			expect(
				closedNoteOpensAt({
					open: true,
					expiresAt,
					openStatus: { status: "closed", opensAt },
				}),
			).toBeNull();
	});

	it("negozio aperto → null", () => {
		expect(
			closedNoteOpensAt({
				open: true,
				expiresAt,
				openStatus: { status: "open" },
			}),
		).toBeNull();
	});

	it("orari non indicati → null", () => {
		expect(
			closedNoteOpensAt({
				open: true,
				expiresAt,
				openStatus: { status: "unknown" },
			}),
		).toBeNull();
	});

	it("prenotazione non più aperta → null", () => {
		expect(
			closedNoteOpensAt({ open: false, expiresAt, openStatus: closed }),
		).toBeNull();
	});

	it("stato del negozio assente → null", () => {
		expect(closedNoteOpensAt({ open: true, expiresAt })).toBeNull();
	});
});
