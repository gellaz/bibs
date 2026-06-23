import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, Marker, TileLayer } from "react-leaflet";

// divIcon HTML lives in the document, so brand CSS vars resolve and stay theme-aware.
const pinIcon = L.divIcon({
	className: "",
	html: `<svg width="32" height="40" viewBox="0 0 24 30" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C6.48 0 2 4.48 2 10c0 6.5 10 20 10 20s10-13.5 10-20C22 4.48 17.52 0 12 0z" fill="var(--saffron)" stroke="var(--ink)" stroke-width="1.5"/><circle cx="12" cy="10" r="3.2" fill="var(--ink)"/></svg>`,
	iconSize: [32, 40],
	iconAnchor: [16, 40],
});

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
			className="h-56 w-full"
			style={{ zIndex: 0 }}
		>
			<TileLayer
				attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
				url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
			/>
			<Marker position={[lat, lng]} icon={pinIcon} title={name} />
		</MapContainer>
	);
}
