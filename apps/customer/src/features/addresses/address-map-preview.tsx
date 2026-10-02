import "leaflet/dist/leaflet.css";
import type { Marker as LeafletMarker } from "leaflet";
import { type RefObject, useEffect, useRef } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { KeepSizeInSync, pinIcon } from "@/features/stores/map-shared";

interface AddressMapPreviewProps {
	/** PostGIS point: `x` è la longitudine, `y` la latitudine. */
	location: { x: number; y: number };
	onMove: (location: { x: number; y: number }) => void;
}

type LatLng = { lat: number; lng: number };

/**
 * Ricentra la mappa quando il form riceve una posizione nuova (per esempio
 * scegliendo un suggerimento): `MapContainer` legge `center` solo al mount.
 * Non quando la posizione nuova è quella dove l'utente ha appena lasciato il
 * pin: il pin è già lì, e spostargli la mappa sotto lo fa saltare.
 */
function RecenterOn({
	lat,
	lng,
	droppedAt,
}: LatLng & { droppedAt: RefObject<LatLng | null> }) {
	const map = useMap();
	useEffect(() => {
		const dropped = droppedAt.current;
		if (dropped && dropped.lat === lat && dropped.lng === lng) return;
		map.setView([lat, lng], map.getZoom());
	}, [map, lat, lng, droppedAt]);
	return null;
}

export default function AddressMapPreview({
	location,
	onMove,
}: AddressMapPreviewProps) {
	const droppedAt = useRef<LatLng | null>(null);

	return (
		<MapContainer
			center={[location.y, location.x]}
			zoom={17}
			scrollWheelZoom={false}
			className="h-48 w-full rounded-lg sm:h-56"
			style={{ zIndex: 0 }}
		>
			<TileLayer
				attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
				url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
			/>
			<Marker
				draggable
				position={[location.y, location.x]}
				icon={pinIcon}
				eventHandlers={{
					dragend: (event) => {
						const { lat, lng } = (event.target as LeafletMarker).getLatLng();
						droppedAt.current = { lat, lng };
						onMove({ x: lng, y: lat });
					},
				}}
			/>
			<RecenterOn lat={location.y} lng={location.x} droppedAt={droppedAt} />
			<KeepSizeInSync />
		</MapContainer>
	);
}
