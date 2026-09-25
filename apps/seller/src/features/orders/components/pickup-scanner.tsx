import { Button } from "@bibs/ui/components/button";
import { ScanLineIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { m } from "@/paraglide/messages";
import { isCompletePickupCode, normalizePickupCode } from "../pickup-code";
import { createScanSession, openCamera } from "../scan-session";

// Al massimo ~6 letture al secondo: basta per un QR fermo davanti alla camera
// e non scalda il telefono.
const DETECT_INTERVAL_MS = 160;

type ScanState = "idle" | "starting" | "scanning";

function cameraErrorMessage(err: unknown): string {
	const name = err instanceof DOMException ? err.name : "";
	if (name === "NotAllowedError" || name === "SecurityError")
		return m.pickup_camera_denied();
	if (name === "NotFoundError" || name === "OverconstrainedError")
		return m.pickup_camera_missing();
	return m.pickup_camera_error();
}

/**
 * Lettura del QR con la fotocamera. `barcode-detector` (ponyfill su zxing-wasm)
 * e il suo wasm si caricano solo al click: niente camera né wasm in SSR, e il
 * wasm si serve dal nostro bundle invece che dal CDN di default.
 */
export function PickupScanner({ onCode }: { onCode: (code: string) => void }) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const frameRef = useRef<number | null>(null);
	const sessionRef = useRef(createScanSession());
	const [state, setState] = useState<ScanState>("idle");
	const [error, setError] = useState<string | null>(null);

	const stop = () => {
		sessionRef.current.cancel();
		if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		frameRef.current = null;
		for (const track of streamRef.current?.getTracks() ?? []) track.stop();
		streamRef.current = null;
		setState("idle");
	};

	// Spegne la camera se si lascia la pagina a scansione aperta.
	useEffect(
		() => () => {
			sessionRef.current.cancel();
			if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
			for (const track of streamRef.current?.getTracks() ?? []) track.stop();
		},
		[],
	);

	const start = async () => {
		setError(null);
		if (!navigator.mediaDevices?.getUserMedia) {
			setError(m.pickup_camera_missing());
			return;
		}
		setState("starting");
		const session = sessionRef.current;
		const token = session.begin();
		const wanted = () => session.isCurrent(token);
		try {
			const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] =
				await Promise.all([
					import("barcode-detector/ponyfill"),
					import("zxing-wasm/reader/zxing_reader.wasm?url"),
				]);
			prepareZXingModule({
				overrides: {
					locateFile: (path: string, prefix: string) =>
						path.endsWith(".wasm") ? wasmUrl : prefix + path,
				},
			});
			const detector = new BarcodeDetector({ formats: ["qr_code"] });
			if (!wanted()) return;

			// «Interrompi» può arrivare mentre il browser chiede il permesso: in
			// quel caso lo stream ottenuto dopo va spento, non acceso.
			const stream = await openCamera(
				() =>
					navigator.mediaDevices.getUserMedia({
						video: { facingMode: "environment" },
						audio: false,
					}),
				wanted,
			);
			if (!stream) return;
			streamRef.current = stream;
			const video = videoRef.current;
			if (!video) {
				stop();
				return;
			}
			video.srcObject = stream;
			await video.play();
			if (!wanted()) return;
			setState("scanning");

			let last = 0;
			let busy = false;
			const tick = (now: number) => {
				frameRef.current = requestAnimationFrame(tick);
				if (busy || now - last < DETECT_INTERVAL_MS) return;
				if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
				last = now;
				busy = true;
				detector
					.detect(video)
					.then((codes) => {
						if (!wanted()) return;
						for (const c of codes) {
							const code = normalizePickupCode(c.rawValue);
							if (isCompletePickupCode(code)) {
								stop();
								onCode(code);
								return;
							}
						}
					})
					.catch(() => {})
					.finally(() => {
						busy = false;
					});
			};
			frameRef.current = requestAnimationFrame(tick);
		} catch (err) {
			if (!wanted()) return;
			stop();
			setError(cameraErrorMessage(err));
		}
	};

	const active = state !== "idle";

	return (
		<div className="space-y-3">
			{active ? (
				<Button type="button" variant="outline" onClick={stop}>
					<XIcon />
					{m.pickup_scan_stop()}
				</Button>
			) : (
				<Button type="button" variant="outline" onClick={() => void start()}>
					<ScanLineIcon />
					{m.pickup_scan()}
				</Button>
			)}
			<video
				ref={videoRef}
				playsInline
				muted
				aria-label={m.pickup_scan_video()}
				className={
					active
						? "aspect-square w-full max-w-xs rounded-xl bg-muted object-cover"
						: "hidden"
				}
			/>
			{error && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
		</div>
	);
}
