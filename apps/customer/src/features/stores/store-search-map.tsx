// `@types/leaflet.markercluster` è puramente ambientale (augmenta il modulo
// `leaflet`), e `tsconfig.web.json` restringe `types` a ["vite/client"]: senza
// questo reference i tipi del cluster non entrano nel programma TS.
/// <reference types="leaflet.markercluster" />
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { Link } from "@tanstack/react-router";
import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { formatDistance, TileImage } from "@/components/tile";
import type { Coords } from "@/features/discovery/use-geolocation";
import { KeepSizeInSync, pinIcon, userLocationIcon } from "./map-shared";
import { openStatusLabel } from "./open-status";
import type { StorePinView } from "./use-store-map";

/** Centro e zoom di partenza: l'Italia intera, finché `FitToPins` non corregge. */
const ITALY_CENTER: [number, number] = [41.9, 12.5];
const ITALY_ZOOM = 5;

/**
 * Bolla di un cluster. Stessa famiglia del pin (saffron su bordo Ink), in stile
 * inline: l'HTML di un divIcon lo inietta Leaflet nel documento, quindi le
 * variabili CSS risolvono senza dipendere dallo scanner di Tailwind.
 */
function clusterIcon(cluster: L.MarkerCluster) {
	const count = cluster.getChildCount();
	const size = count < 10 ? 36 : count < 100 ? 44 : 52;
	return L.divIcon({
		className: "",
		html: `<div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:9999px;background:var(--saffron);border:2px solid var(--ink);color:var(--ink);font-family:var(--font-mono);font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;box-shadow:0 1px 4px rgb(0 0 0 / 0.25)">${count}</div>`,
		iconSize: L.point(size, size, true),
	});
}

/**
 * Inquadra i pin a ogni cambio dell'insieme. Il set cambia quando cambiano i
 * filtri, non a ogni render: la chiave lo riassume.
 */
function FitToPins({ pins }: { pins: StorePinView[] }) {
	const map = useMap();
	const key = pins.map((p) => p.id).join(",");

	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` riassume `pins`
	useEffect(() => {
		if (pins.length === 0) return;
		if (pins.length === 1) {
			map.setView([pins[0].lat, pins[0].lng], 15);
			return;
		}
		map.fitBounds(
			L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])),
			{ padding: [48, 48] },
		);
	}, [key, map]);

	return null;
}

/** Mini-card del popup: gli stessi pezzi del tile, in formato orizzontale. */
function PinCard({
	pin,
	showDistance,
}: {
	pin: StorePinView;
	showDistance: boolean;
}) {
	const hasDistance = showDistance && pin.distance !== null;
	return (
		<Link
			to="/stores/$storeId"
			params={{ storeId: pin.id }}
			className="group flex w-56 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-saffron"
		>
			<div className="size-14 shrink-0 overflow-hidden rounded-md border border-border">
				<TileImage url={pin.imageUrl} name={pin.name} />
			</div>
			<div className="flex min-w-0 flex-col gap-0.5">
				<span className="line-clamp-2 font-medium text-[0.875rem] text-foreground leading-snug group-hover:text-primary">
					{pin.name}
				</span>
				<span className="truncate text-muted-foreground text-xs">
					{pin.category ? `${pin.category.name} · ` : ""}
					{pin.city} ({pin.province})
				</span>
				<span
					className={`text-xs ${pin.openStatus.isOpen ? "text-primary" : "text-muted-foreground"}`}
				>
					{openStatusLabel(pin.openStatus)}
					{hasDistance && ` · ${formatDistance(pin.distance as number)}`}
				</span>
			</div>
		</Link>
	);
}

/**
 * I risultati della ricerca su mappa. Stessi negozi della lista: spostare la
 * mappa non rifà la ricerca, sono i filtri a decidere cosa si vede.
 */
export default function StoreSearchMap({
	pins,
	showDistance,
	userCoords,
}: {
	pins: StorePinView[];
	showDistance: boolean;
	userCoords: Coords | null;
}) {
	return (
		<MapContainer
			center={ITALY_CENTER}
			zoom={ITALY_ZOOM}
			scrollWheelZoom={false}
			className="h-full w-full"
			style={{ zIndex: 0 }}
		>
			<TileLayer
				attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
				url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
			/>
			<MarkerClusterGroup
				iconCreateFunction={clusterIcon}
				showCoverageOnHover={false}
				maxClusterRadius={60}
			>
				{pins.map((pin) => (
					<Marker
						key={pin.id}
						position={[pin.lat, pin.lng]}
						icon={pinIcon}
						title={pin.name}
					>
						<Popup>
							<PinCard pin={pin} showDistance={showDistance} />
						</Popup>
					</Marker>
				))}
			</MarkerClusterGroup>
			{userCoords && (
				<Marker
					position={[userCoords.lat, userCoords.lng]}
					icon={userLocationIcon}
					title="La tua posizione"
				/>
			)}
			<FitToPins pins={pins} />
			<KeepSizeInSync />
		</MapContainer>
	);
}
