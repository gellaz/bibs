import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLocale, overwriteGetLocale } from "@/paraglide/runtime";
import { saveStoreProfile } from "./save-store-profile";

const originalGetLocale = getLocale;
beforeEach(() => overwriteGetLocale(() => "it"));
afterEach(() => overwriteGetLocale(originalGetLocale));

const file = new File(["x"], "foto.png", { type: "image/png" });

describe("saveStoreProfile", () => {
	it("salva i campi e restituisce le foto caricate", async () => {
		const result = await saveStoreProfile({
			save: async () => ({ id: "s1" }),
			upload: async () => [{ id: "i1", url: "u1" }],
			files: [file],
		});
		expect(result).toEqual({
			store: { id: "s1" },
			uploaded: [{ id: "i1", url: "u1" }],
		});
	});

	it("senza foto nuove non chiama il caricamento", async () => {
		let uploads = 0;
		const result = await saveStoreProfile({
			save: async () => ({ id: "s1" }),
			upload: async () => {
				uploads++;
				return [];
			},
			files: [],
		});
		expect(uploads).toBe(0);
		expect(result.uploaded).toEqual([]);
	});

	it("caricamento fallito: errore, così le foto scelte restano da salvare", async () => {
		let saved = false;
		await expect(
			saveStoreProfile({
				save: async () => {
					saved = true;
					return { id: "s1" };
				},
				upload: async () => null,
				files: [file],
			}),
		).rejects.toThrow("Negozio aggiornato ma errore nel caricamento immagini");
		expect(saved).toBe(true);
	});
});
