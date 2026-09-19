import "leaflet/dist/leaflet.css";
import type { Marker as LeafletMarker } from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { KeepSizeInSync, pinIcon } from "@/features/stores/map-shared";

interface AddressMapPreviewProps {
	/** PostGIS point: `x` è la longitudine, `y` la latitudine. */
	location: { x: number; y: number };
	onMove: (location: { x: number; y: number }) => void;
}

/**
 * Ricentra la mappa quando il form riceve una posizione nuova (per esempio
 * scegliendo un suggerimento): `MapContainer` legge `center` solo al mount.
 */
function RecenterOn({ lat, lng }: { lat: number; lng: number }) {
	const map = useMap();
	useEffect(() => {
		map.setView([lat, lng], map.getZoom());
	}, [map, lat, lng]);
	return null;
}

export default function AddressMapPreview({
	location,
	onMove,
}: AddressMapPreviewProps) {
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
						onMove({ x: lng, y: lat });
					},
				}}
			/>
			<RecenterOn lat={location.y} lng={location.x} />
			<KeepSizeInSync />
		</MapContainer>
	);
}
