import { Button } from "@bibs/ui/components/button";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Compass, Globe, MapPin, Phone, RotateCw } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { OpeningHours } from "@/features/stores/opening-hours";
import { StoreCover } from "@/features/stores/store-cover";
import { useStoreDetail } from "@/features/stores/use-store-detail";

const LazyStoreMap = lazy(() => import("@/features/stores/store-map"));

export const Route = createFileRoute("/_authenticated/stores/$storeId")({
	component: StoreDetailPage,
});

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-3">
			<h2 className="font-display font-semibold text-foreground text-lg">
				{title}
			</h2>
			{children}
		</section>
	);
}

function MapSkeleton() {
	return (
		<div
			className="h-56 w-full animate-pulse rounded-xl bg-muted"
			aria-hidden
		/>
	);
}

function MapSection({
	coordinates,
	name,
	address,
}: {
	coordinates: { lat: number; lng: number };
	name: string;
	address: string;
}) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const mapsHref = `https://www.google.com/maps/search/?api=1&query=${coordinates.lat},${coordinates.lng}`;
	return (
		<Section title="Dove siamo">
			<div className="relative isolate overflow-hidden rounded-xl border border-border">
				{mounted ? (
					<Suspense fallback={<MapSkeleton />}>
						<LazyStoreMap
							lat={coordinates.lat}
							lng={coordinates.lng}
							name={name}
						/>
					</Suspense>
				) : (
					<MapSkeleton />
				)}
			</div>
			<p className="text-muted-foreground text-sm">{address}</p>
			<Button asChild variant="secondary" size="sm">
				<a href={mapsHref} target="_blank" rel="noopener noreferrer">
					<MapPin className="size-4" aria-hidden />
					Apri in Mappe
				</a>
			</Button>
		</Section>
	);
}

function StoreDetailPage() {
	const { storeId } = Route.useParams();
	const { data: store, isPending, isError, refetch } = useStoreDetail(storeId);

	if (isPending) {
		return (
			<div>
				<Skeleton className="h-64 w-full sm:h-80" />
				<div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
					<Skeleton className="h-24 w-full" />
					<Skeleton className="h-56 w-full" />
				</div>
			</div>
		);
	}

	if (isError) {
		return (
			<NoticePage
				icon={RotateCw}
				title="Non siamo riusciti a caricare il negozio"
				description="Qualcosa è andato storto. Riprova tra un momento."
				action={
					<Button variant="secondary" size="sm" onClick={() => refetch()}>
						<RotateCw className="size-4" aria-hidden />
						Riprova
					</Button>
				}
			/>
		);
	}

	if (!store) {
		return (
			<NoticePage
				icon={Compass}
				title="Negozio non trovato"
				description="Questo negozio non esiste o non è più disponibile."
				action={
					<Button asChild variant="secondary" size="sm">
						<Link to="/stores" search={{ q: undefined, categoryId: undefined }}>
							Torna ai negozi
						</Link>
					</Button>
				}
			/>
		);
	}

	const cover = store.images[0]?.url ?? null;
	const address = `${store.addressLine1}${store.addressLine2 ? `, ${store.addressLine2}` : ""} · ${store.zipCode} ${store.city} (${store.province})`;
	const safeWebsiteUrl = (() => {
		if (!store.websiteUrl) return null;
		try {
			const u = new URL(store.websiteUrl);
			return u.protocol === "http:" || u.protocol === "https:"
				? u.toString()
				: null;
		} catch {
			return null;
		}
	})();
	const hasContacts = store.phoneNumbers.length > 0 || Boolean(safeWebsiteUrl);

	return (
		<div>
			<StoreCover
				name={store.name}
				imageUrl={cover}
				categoryName={store.category?.name ?? null}
				city={store.city}
				province={store.province}
				openStatus={store.openStatus}
			/>

			<div className="mx-auto max-w-3xl space-y-8 px-4 py-8">
				{store.images.length > 1 && (
					<ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
						{store.images.slice(1).map((img) => (
							<li key={img.id} className="shrink-0">
								<img
									src={img.url}
									alt={store.name}
									loading="lazy"
									decoding="async"
									className="h-28 w-40 rounded-lg border border-border object-cover"
								/>
							</li>
						))}
					</ul>
				)}

				{store.description && (
					<Section title="Descrizione">
						<p className="whitespace-pre-line text-muted-foreground text-sm leading-relaxed">
							{store.description}
						</p>
					</Section>
				)}

				<Section title="Orari">
					<OpeningHours openingHours={store.openingHours} />
				</Section>

				{store.coordinates && (
					<MapSection
						coordinates={store.coordinates}
						name={store.name}
						address={address}
					/>
				)}

				{hasContacts && (
					<Section title="Contatti">
						<ul className="space-y-2">
							{store.phoneNumbers.map((p) => (
								<li key={p.id}>
									<a
										href={`tel:${p.number}`}
										className="inline-flex items-center gap-2 text-foreground text-sm hover:text-primary"
									>
										<Phone
											className="size-4 text-muted-foreground"
											aria-hidden
										/>
										{p.label ? `${p.label}: ${p.number}` : p.number}
									</a>
								</li>
							))}
							{safeWebsiteUrl && (
								<li>
									<a
										href={safeWebsiteUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="inline-flex items-center gap-2 text-foreground text-sm hover:text-primary"
									>
										<Globe
											className="size-4 text-muted-foreground"
											aria-hidden
										/>
										Sito web
									</a>
								</li>
							)}
						</ul>
					</Section>
				)}
			</div>
		</div>
	);
}

function NoticePage({
	icon: Icon,
	title,
	description,
	action,
}: {
	icon: typeof Compass;
	title: string;
	description: string;
	action?: React.ReactNode;
}) {
	return (
		<div className="mx-auto w-full max-w-3xl px-4 py-16">
			<div className="flex flex-col items-center gap-4 rounded-xl border border-border border-dashed px-6 py-14 text-center">
				<div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
					<Icon className="size-6" aria-hidden />
				</div>
				<div className="space-y-1">
					<h1 className="font-display font-semibold text-foreground text-lg">
						{title}
					</h1>
					<p className="mx-auto max-w-sm text-muted-foreground text-sm leading-relaxed">
						{description}
					</p>
				</div>
				{action}
			</div>
		</div>
	);
}
