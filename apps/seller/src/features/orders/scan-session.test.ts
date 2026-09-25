import { describe, expect, it } from "bun:test";
import { createScanSession, openCamera } from "./scan-session";

function fakeStream() {
	const stopped: boolean[] = [false];
	const track = { stop: () => (stopped[0] = true) };
	const stream = { getTracks: () => [track] } as unknown as MediaStream;
	return { stream, stopped };
}

describe("openCamera", () => {
	it("restituisce lo stream se la scansione è ancora voluta", async () => {
		const session = createScanSession();
		const token = session.begin();
		const { stream, stopped } = fakeStream();
		const got = await openCamera(
			async () => stream,
			() => session.isCurrent(token),
		);
		expect(got).toBe(stream);
		expect(stopped[0]).toBe(false);
	});

	it("«Interrompi» durante il prompt dei permessi: spegne lo stream appena arriva", async () => {
		const session = createScanSession();
		const token = session.begin();
		const { stream, stopped } = fakeStream();
		let grant: (s: MediaStream) => void = () => {};
		const pending = openCamera(
			() => new Promise<MediaStream>((r) => (grant = r)),
			() => session.isCurrent(token),
		);
		session.cancel(); // il negoziante tocca «Interrompi»
		grant(stream); // poi «Consenti» sul prompt
		expect(await pending).toBeNull();
		expect(stopped[0]).toBe(true);
	});

	it("un nuovo avvio invalida quello precedente", () => {
		const session = createScanSession();
		const first = session.begin();
		const second = session.begin();
		expect(session.isCurrent(first)).toBe(false);
		expect(session.isCurrent(second)).toBe(true);
	});
});
