import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sellerPkg from "../../../package.json";

// `exports` di barcode-detector non espone package.json: lo si legge dal file,
// risalendo da dist/es/index.js.
const barcodeDetectorPkg = JSON.parse(
	readFileSync(
		new URL("../../package.json", import.meta.resolve("barcode-detector")),
		"utf8",
	),
) as { dependencies: Record<string, string> };

// Il seller serve zxing_reader.wasm dalla sua copia diretta di zxing-wasm,
// mentre il JS che lo carica arriva da barcode-detector: se le versioni
// divergono il wasm non combacia col glue e la scansione fallisce solo a
// runtime («Non riusciamo ad avviare la fotocamera»).
describe("dipendenze dello scanner", () => {
	it("barcode-detector è pinnato esatto", () => {
		expect(sellerPkg.dependencies["barcode-detector"]).toMatch(
			/^\d+\.\d+\.\d+$/,
		);
	});

	it("zxing-wasm diretto = quello richiesto da barcode-detector", () => {
		expect(sellerPkg.dependencies["zxing-wasm"]).toBe(
			barcodeDetectorPkg.dependencies["zxing-wasm"],
		);
	});
});
