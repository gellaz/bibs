import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, TileLayer } from "react-leaflet";
import { KeepSizeInSync, pinIcon } from "./map-shared";

export default function StoreMap({
	lat,
	lng,
	name,
}: {
	lat: number;
	lng: number;
	name: string;
}) {
	return (
		<MapContainer
			center={[lat, lng]}
			zoom={15}
			scrollWheelZoom={false}
			className="h-48 w-full sm:h-56 lg:h-40"
			style={{ zIndex: 0 }}
		>
			<TileLayer
				attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
				url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
			/>
			<Marker position={[lat, lng]} icon={pinIcon} title={name} />
			<KeepSizeInSync />
		</MapContainer>
	);
}
