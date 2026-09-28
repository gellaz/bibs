import "leaflet/dist/leaflet.css";
import L, { type Marker as LeafletMarker } from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";

/**
 * Pin del negozio. L'HTML di un `divIcon` vive nel documento, quindi le
 * variabili CSS del brand risolvono e restano theme-aware.
 */
const pinIcon = L.divIcon({
	className: "",
	html: `<svg width="32" height="40" viewBox="0 0 24 30" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C6.48 0 2 4.48 2 10c0 6.5 10 20 10 20s10-13.5 10-20C22 4.48 17.52 0 12 0z" fill="var(--cobalt)" stroke="var(--ink)" stroke-width="1.5"/><circle cx="12" cy="10" r="3.2" fill="var(--cream)"/></svg>`,
	iconSize: [32, 40],
	iconAnchor: [16, 40],
});

interface StoreMapPreviewProps {
	/** PostGIS point: `x` è la longitudine, `y` la latitudine. */
	location: { x: number; y: number };
	onMove: (location: { x: number; y: number }) => void;
	readOnly?: boolean;
}

/**
 * Ricentra la mappa quando arriva una posizione nuova da un suggerimento:
 * `MapContainer` legge `center` solo al mount. Il trascinamento del pin non
 * cambia `location` dall'esterno in modo visibile, quindi non fa saltare la
 * vista (il pin resta dove l'hai lasciato).
 */
function RecenterOn({ lat, lng }: { lat: number; lng: number }) {
	const map = useMap();
	useEffect(() => {
		if (!map.getBounds().contains([lat, lng])) {
			map.setView([lat, lng], map.getZoom());
		}
	}, [map, lat, lng]);
	return null;
}

/**
 * Leaflet calcola la dimensione una volta al mount: quando il contenitore
 * cambia larghezza col breakpoint, senza questo resta una banda grigia.
 */
function KeepSizeInSync() {
	const map = useMap();
	useEffect(() => {
		const observer = new ResizeObserver(() => map.invalidateSize());
		observer.observe(map.getContainer());
		return () => observer.disconnect();
	}, [map]);
	return null;
}

export default function StoreMapPreview({
	location,
	onMove,
	readOnly = false,
}: StoreMapPreviewProps) {
	return (
		<MapContainer
			center={[location.y, location.x]}
			zoom={17}
			scrollWheelZoom={false}
			className="h-56 w-full rounded-lg"
			style={{ zIndex: 0 }}
		>
			<TileLayer
				attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
				url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
			/>
			<Marker
				draggable={!readOnly}
				position={[location.y, location.x]}
				icon={pinIcon}
				eventHandlers={{
					dragend: (event) => {
						const { lat, lng } = (event.target as LeafletMarker).getLatLng();
						onMove({ x: lng, y: lat });
					},
				}}
			/>
			<RecenterOn lat={location.y} lng={location.x} />
			<KeepSizeInSync />
		</MapContainer>
	);
}
