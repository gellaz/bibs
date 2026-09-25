/**
 * Generazione della scansione in corso: ogni avvio ne apre una nuova, lo stop
 * la chiude. Serve perché l'avvio attende il prompt dei permessi e il wasm, e
 * nel frattempo il negoziante può aver già toccato «Interrompi».
 */
export function createScanSession() {
	let current = 0;
	return {
		begin: () => ++current,
		cancel: () => {
			current++;
		},
		isCurrent: (token: number) => token === current,
	};
}

/**
 * Apre la camera e, se nel frattempo la scansione non è più voluta, spegne
 * subito lo stream appena ottenuto invece di lasciarlo acceso.
 */
export async function openCamera(
	open: () => Promise<MediaStream>,
	stillWanted: () => boolean,
): Promise<MediaStream | null> {
	const stream = await open();
	if (stillWanted()) return stream;
	for (const track of stream.getTracks()) track.stop();
	return null;
}
