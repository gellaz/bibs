export interface CropArea {
	x: number;
	y: number;
	width: number;
	height: number;
}

const OUTPUT_SIZE = 512;

/**
 * Ritaglia `imageSrc` sulla regione `area` (in pixel della sorgente originale)
 * e produce un Blob JPEG quadrato di OUTPUT_SIZE × OUTPUT_SIZE pixel.
 *
 * Usato da AvatarUploadDialog dopo la conferma del crop di react-easy-crop.
 */
export async function cropImageToBlob(
	imageSrc: string,
	area: CropArea,
): Promise<Blob> {
	const img = await loadImage(imageSrc);
	const canvas = document.createElement("canvas");
	canvas.width = OUTPUT_SIZE;
	canvas.height = OUTPUT_SIZE;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas 2D context non disponibile");

	ctx.drawImage(
		img,
		area.x,
		area.y,
		area.width,
		area.height,
		0,
		0,
		OUTPUT_SIZE,
		OUTPUT_SIZE,
	);

	return await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (!blob) reject(new Error("Generazione blob fallita"));
				else resolve(blob);
			},
			"image/jpeg",
			0.9,
		);
	});
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("Caricamento immagine fallito"));
		img.crossOrigin = "anonymous";
		img.src = src;
	});
}
