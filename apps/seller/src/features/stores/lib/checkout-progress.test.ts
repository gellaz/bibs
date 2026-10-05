import { ApiError } from "@bibs/ui/lib/api-error";
import { describe, expect, it, vi } from "vitest";
import { checkoutProgress, finishCheckout } from "./checkout-progress";

const base = { sessionId: "cs_test", timedOut: false };

describe("checkoutProgress", () => {
	it("aspetta finché la sessione è aperta o lo stato non è arrivato", () => {
		expect(checkoutProgress(base)).toEqual({ kind: "waiting" });
		expect(checkoutProgress({ ...base, status: "open" })).toEqual({
			kind: "waiting",
		});
	});

	it("è pronto quando il webhook ha creato il negozio", () => {
		expect(
			checkoutProgress({ ...base, status: "ready", storeId: "store-1" }),
		).toEqual({ kind: "ready", storeId: "store-1" });
	});

	it("ready senza storeId continua ad aspettare", () => {
		expect(checkoutProgress({ ...base, status: "ready" })).toEqual({
			kind: "waiting",
		});
	});

	it("va in timeout solo se il negozio non è ancora pronto", () => {
		expect(
			checkoutProgress({ ...base, status: "open", timedOut: true }),
		).toEqual({ kind: "timeout" });
		expect(
			checkoutProgress({
				...base,
				status: "ready",
				storeId: "store-1",
				timedOut: true,
			}),
		).toEqual({ kind: "ready", storeId: "store-1" });
	});

	it("fallisce senza sessione, con sessione sconosciuta, scaduta o annullata", () => {
		expect(checkoutProgress({ ...base, sessionId: "" }).kind).toBe("failed");
		expect(
			checkoutProgress({ ...base, error: new ApiError("Non trovata", 404) })
				.kind,
		).toBe("failed");
		expect(checkoutProgress({ ...base, status: "expired" }).kind).toBe(
			"failed",
		);
		expect(checkoutProgress({ ...base, status: "canceled" }).kind).toBe(
			"failed",
		);
	});

	it("tratta gli altri errori come transitori", () => {
		expect(
			checkoutProgress({ ...base, error: new ApiError("Errore", 500) }).kind,
		).toBe("waiting");
		expect(
			checkoutProgress({ ...base, error: new TypeError("fetch") }).kind,
		).toBe("waiting");
		expect(
			checkoutProgress({
				...base,
				error: new ApiError("Errore", 500),
				timedOut: true,
			}).kind,
		).toBe("timeout");
	});
});

describe("finishCheckout", () => {
	it("sceglie il negozio attivo solo dopo il refetch dei negozi, poi avvisa e va in home", async () => {
		const calls: string[] = [];
		let resolveRefetch = () => {};
		const refetchStores = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					calls.push("refetch");
					resolveRefetch = resolve;
				}),
		);
		const setActiveStoreId = vi.fn((id: string) => calls.push(`active:${id}`));
		const notify = vi.fn(() => calls.push("toast"));
		const goHome = vi.fn(() => calls.push("home"));

		const done = finishCheckout("store-9", {
			refetchStores,
			setActiveStoreId,
			notify,
			goHome,
		});
		await Promise.resolve();
		expect(calls).toEqual(["refetch"]);

		resolveRefetch();
		await done;
		expect(calls).toEqual(["refetch", "active:store-9", "toast", "home"]);
	});
});
