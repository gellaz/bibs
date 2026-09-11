import { Button } from "@bibs/ui/components/button";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Compass, Globe, MapPin, Phone, RotateCw } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { NoticePage } from "@/components/notice";
import { PAGE_CONTAINER } from "@/components/page";
import { OpeningHours } from "@/features/stores/opening-hours";
import { StoreCover } from "@/features/stores/store-cover";
import { StoreDescription } from "@/features/stores/store-description";
import { StoreProducts } from "@/features/stores/store-products";
import type { StoreDetailView } from "@/features/stores/use-store-detail";
import { useStoreDetail } from "@/features/stores/use-store-detail";
import { m } from "@/paraglide/messages";

const LazyStoreMap = lazy(() => import("@/features/stores/store-map"));

export const Route = createFileRoute("/_authenticated/stores/$storeId")({
	component: StoreDetailPage,
});

/**
 * Colonna centrale (catalogo) + rail di consultazione a destra da `lg`. Sotto
 * `lg` tutto si impila: una riga essenziale sotto la cover (dove siamo, come
 * chiamare) e la descrizione prima dei prodotti, orari/mappa/contatti in fondo.
 * Le colonne del catalogo le decide la larghezza della colonna, non il
 * viewport (vedi `store-products`).
 */
const LAYOUT_GRID =
	"grid items-start gap-x-8 gap-y-12 lg:grid-cols-[minmax(0,1fr)_19rem] xl:gap-x-10 xl:grid-cols-[minmax(0,1fr)_21rem]";

/** Sezione del rail: etichetta sottile, il peso tipografico resta ai prodotti. */
function RailSection({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-2.5">
			<h2 className="font-medium text-[0.8125rem] text-foreground tracking-[0.04em]">
				{title}
			</h2>
			{children}
		</section>
	);
}

function MapSkeleton() {
	return (
		<div
			className="h-48 w-full animate-pulse bg-muted sm:h-56 lg:h-40"
			aria-hidden
		/>
	);
}

/** La mappa è DOM-only: monta solo dopo l'hydration, mai in SSR. */
function StoreMapFrame({
	coordinates,
	name,
}: {
	coordinates: { lat: number; lng: number };
	name: string;
}) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	return (
		<div className="relative isolate overflow-hidden rounded-lg border border-border">
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
	);
}

function StoreAside({
	store,
	streetLine,
	cityLine,
	mapsHref,
}: {
	store: StoreDetailView;
	streetLine: string;
	cityLine: string;
	mapsHref: string | null;
}) {
	const hasContacts =
		store.phoneNumbers.length > 0 || Boolean(store.websiteUrl);
	return (
		<aside className="info-rail space-y-7">
			{store.description && (
				<div className="max-lg:hidden">
					<RailSection title={m.store_description_title()}>
						<StoreDescription
							text={store.description}
							clampClassName="line-clamp-4"
						/>
					</RailSection>
				</div>
			)}

			<RailSection title={m.store_hours_title()}>
				<OpeningHours openingHours={store.openingHours} />
			</RailSection>

			<RailSection title={m.store_location_title()}>
				{store.coordinates && (
					<StoreMapFrame coordinates={store.coordinates} name={store.name} />
				)}
				<p className="text-muted-foreground text-sm leading-relaxed">
					{streetLine}
					<span className="block">{cityLine}</span>
				</p>
				{mapsHref && (
					<Button asChild variant="secondary" size="sm">
						<a href={mapsHref} target="_blank" rel="noopener noreferrer">
							<MapPin className="size-4" aria-hidden />
							{m.store_open_maps()}
						</a>
					</Button>
				)}
			</RailSection>

			{hasContacts && (
				<RailSection title={m.store_contacts_title()}>
					<ul className="space-y-2.5">
						{store.phoneNumbers.map((p) => (
							<li key={p.id}>
								<a
									href={`tel:${p.number}`}
									className="inline-flex items-baseline gap-2 text-sm hover:text-primary"
								>
									<Phone
										className="size-4 shrink-0 translate-y-0.5 text-muted-foreground"
										aria-hidden
									/>
									<span className="text-foreground">
										{p.number}
										{p.label && (
											<span className="block text-muted-foreground text-xs">
												{p.label}
											</span>
										)}
									</span>
								</a>
							</li>
						))}
						{store.websiteUrl && (
							<li>
								<a
									href={store.websiteUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-2 text-foreground text-sm hover:text-primary"
								>
									<Globe
										className="size-4 shrink-0 text-muted-foreground"
										aria-hidden
									/>
									{m.store_website_link()}
								</a>
							</li>
						)}
					</ul>
				</RailSection>
			)}
		</aside>
	);
}

/**
 * Sotto `lg` il rail finisce in fondo alla pagina: questa riga risponde subito
 * alle due domande da telefono — dove siete, come vi chiamo — senza far
 * scorrere il catalogo. Lo stato di apertura non si ripete: è già sulla cover.
 */
function QuickFacts({
	streetLine,
	cityLine,
	mapsHref,
	phoneNumber,
}: {
	streetLine: string;
	cityLine: string;
	mapsHref: string | null;
	phoneNumber: string | null;
}) {
	const address = (
		<span className="min-w-0">
			{streetLine}
			<span className="block text-muted-foreground">{cityLine}</span>
		</span>
	);
	return (
		<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-border border-b pb-6 lg:hidden">
			{mapsHref ? (
				<a
					href={mapsHref}
					target="_blank"
					rel="noopener noreferrer"
					className="group inline-flex items-start gap-2 text-foreground text-sm leading-relaxed"
				>
					<MapPin
						className="mt-0.5 size-4 shrink-0 text-saffron-deep"
						aria-hidden
					/>
					<span className="min-w-0 group-hover:underline">{address}</span>
				</a>
			) : (
				<p className="inline-flex items-start gap-2 text-foreground text-sm leading-relaxed">
					<MapPin
						className="mt-0.5 size-4 shrink-0 text-saffron-deep"
						aria-hidden
					/>
					{address}
				</p>
			)}
			{phoneNumber && (
				<Button asChild variant="secondary" size="sm">
					<a href={`tel:${phoneNumber}`}>
						<Phone className="size-4" aria-hidden />
						{m.store_call()}
					</a>
				</Button>
			)}
		</div>
	);
}

/**
 * Le altre foto della vetrina (al massimo sette: il negozio ne carica otto in
 * tutto e la prima è la cover). Striscia elastica, non griglia: le foto si
 * allargano per riempire la colonna quando sono poche e scorrono in orizzontale
 * quando sono tante, senza mai lasciare celle vuote in fondo a una riga.
 */
function PhotoStrip({
	images,
	name,
}: {
	images: { id: string; url: string }[];
	name: string;
}) {
	return (
		<ul
			aria-label={m.store_gallery_aria()}
			className="flex gap-3 overflow-x-auto pb-1 [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] max-lg:-mx-4 max-lg:px-4 sm:max-lg:-mx-6 sm:max-lg:px-6"
		>
			{images.map((img) => (
				<li key={img.id} className="shrink-0 grow basis-44 @2xl:max-w-72">
					<img
						src={img.url}
						alt={name}
						loading="lazy"
						decoding="async"
						className="h-32 w-full rounded-lg border border-border object-cover @2xl:h-44"
					/>
				</li>
			))}
		</ul>
	);
}

function StoreDetailSkeleton() {
	return (
		<div>
			<Skeleton className="h-64 w-full rounded-none sm:h-80 xl:h-96" />
			<div className={`${PAGE_CONTAINER} py-8 sm:py-10`}>
				<div className={LAYOUT_GRID}>
					<div className="space-y-4">
						<Skeleton className="h-6 w-32" />
						<Skeleton className="h-72 w-full" />
					</div>
					<div className="space-y-7 max-lg:hidden">
						<Skeleton className="h-24 w-full" />
						<Skeleton className="h-60 w-full" />
					</div>
				</div>
			</div>
		</div>
	);
}

function StoreDetailPage() {
	const { storeId } = Route.useParams();
	const { data: store, isPending, isError, refetch } = useStoreDetail(storeId);

	if (isPending) return <StoreDetailSkeleton />;

	if (isError) {
		return (
			<NoticePage
				icon={RotateCw}
				title={m.store_detail_load_error_title()}
				description={m.store_load_error_description()}
				action={
					<Button variant="secondary" size="sm" onClick={() => refetch()}>
						<RotateCw className="size-4" aria-hidden />
						{m.store_retry()}
					</Button>
				}
			/>
		);
	}

	if (!store) {
		return (
			<NoticePage
				icon={Compass}
				title={m.store_not_found_title()}
				description={m.store_not_found_description()}
				action={
					<Button asChild variant="secondary" size="sm">
						<Link to="/stores" search={{ q: undefined, categoryId: undefined }}>
							{m.store_back_to_stores()}
						</Link>
					</Button>
				}
			/>
		);
	}

	const cover = store.images[0]?.url ?? null;
	const gallery = store.images.slice(1);
	const streetLine = `${store.addressLine1}${store.addressLine2 ? `, ${store.addressLine2}` : ""}`;
	const cityLine = `${store.zipCode} ${store.city} (${store.province})`;
	const mapsHref = store.coordinates
		? `https://www.google.com/maps/search/?api=1&query=${store.coordinates.lat},${store.coordinates.lng}`
		: null;
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

			<div className={`${PAGE_CONTAINER} py-8 sm:py-10`}>
				<QuickFacts
					streetLine={streetLine}
					cityLine={cityLine}
					mapsHref={mapsHref}
					phoneNumber={store.phoneNumbers[0]?.number ?? null}
				/>

				<div className={`${LAYOUT_GRID} mt-8`}>
					<div className="@container min-w-0 space-y-8">
						{store.description && (
							<div className="max-w-[65ch] lg:hidden">
								<RailSection title={m.store_description_title()}>
									<StoreDescription text={store.description} />
								</RailSection>
							</div>
						)}
						{gallery.length > 0 && (
							<PhotoStrip images={gallery} name={store.name} />
						)}
						<StoreProducts storeId={store.id} />
					</div>

					<StoreAside
						store={{ ...store, websiteUrl: safeWebsiteUrl }}
						streetLine={streetLine}
						cityLine={cityLine}
						mapsHref={mapsHref}
					/>
				</div>
			</div>
		</div>
	);
}
