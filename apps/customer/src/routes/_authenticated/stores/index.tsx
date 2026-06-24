import { Button } from "@bibs/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Compass, LocateFixed, MapPin, RotateCw, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GRID, TileSkeleton } from "@/components/tile";
import { useGeolocation } from "@/features/discovery/use-geolocation";
import { StoreTile } from "@/features/stores/store-tile";
import { useStoreSearch } from "@/features/stores/use-store-search";
import { api } from "@/lib/api";

const SEARCH_SCHEMA = (search: Record<string, unknown>) => ({
	q: typeof search.q === "string" ? search.q : undefined,
	categoryId:
		typeof search.categoryId === "string" ? search.categoryId : undefined,
});

export const Route = createFileRoute("/_authenticated/stores/")({
	validateSearch: SEARCH_SCHEMA,
	component: StoresPage,
});

function Notice({
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
		<div className="flex flex-col items-center gap-4 rounded-xl border border-border border-dashed px-6 py-14 text-center">
			<div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
				<Icon className="size-6" aria-hidden />
			</div>
			<div className="space-y-1">
				<h3 className="font-display font-semibold text-foreground text-lg">
					{title}
				</h3>
				<p className="mx-auto max-w-sm text-muted-foreground text-sm leading-relaxed">
					{description}
				</p>
			</div>
			{action}
		</div>
	);
}

function useStoreCategories() {
	return useQuery({
		queryKey: ["store-categories"],
		staleTime: 5 * 60_000,
		queryFn: async () => {
			const { data, error } = await api()["store-categories"].get({
				query: { limit: 100 },
			});
			if (error) throw new Error("Categorie non disponibili");
			return data.data;
		},
	});
}

function StoresPage() {
	const navigate = Route.useNavigate();
	const { q, categoryId } = Route.useSearch();
	const [text, setText] = useState(q ?? "");
	const {
		coords,
		status: geoStatus,
		request: requestLocation,
	} = useGeolocation();
	const { data: categories } = useStoreCategories();

	// Debounce the text input into the URL search param.
	useEffect(() => {
		const id = setTimeout(() => {
			void navigate({
				search: (prev) => ({ ...prev, q: text || undefined }),
				replace: true,
			});
		}, 300);
		return () => clearTimeout(id);
	}, [text, navigate]);

	// Sync the controlled input when `q` changes externally (browser back/forward, deep-link).
	const prevQ = useRef(q);
	useEffect(() => {
		if (q !== prevQ.current) {
			prevQ.current = q;
			setText(q ?? "");
		}
	}, [q]);

	const {
		stores,
		hasNextPage,
		fetchNextPage,
		isFetchingNextPage,
		isPending,
		isError,
		refetch,
	} = useStoreSearch({ q, categoryId, coords });

	const hasQuery = Boolean(q) || Boolean(categoryId);

	return (
		<div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
			<section className="space-y-1">
				<h1 className="font-bold font-display text-2xl text-primary tracking-[-0.015em]">
					Negozi
				</h1>
				<p className="text-muted-foreground text-sm">
					Trova i negozi vicino a te. Cerca per nome o città.
				</p>
			</section>

			<div className="mt-6 flex flex-wrap items-center gap-3">
				<div className="relative min-w-0 flex-1">
					<Search
						className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground"
						aria-hidden
					/>
					<input
						type="search"
						value={text}
						onChange={(e) => setText(e.target.value)}
						placeholder="Cerca un negozio o un comune…"
						aria-label="Cerca negozi"
						className="h-10 w-full rounded-md border border-border bg-background pr-3 pl-9 text-foreground text-sm outline-none focus-visible:ring-2 focus-visible:ring-saffron"
					/>
				</div>
				{geoStatus === "granted" ? (
					<span className="inline-flex items-center gap-1.5 text-saffron-deep text-sm dark:text-saffron">
						<LocateFixed className="size-4" aria-hidden />
						Ordinati per vicinanza
					</span>
				) : (
					<Button
						variant="secondary"
						size="sm"
						onClick={requestLocation}
						disabled={geoStatus === "pending"}
					>
						<MapPin className="size-4" aria-hidden />
						{geoStatus === "pending" ? "Rilevamento…" : "Vicino a me"}
					</Button>
				)}
			</div>

			{categories && categories.length > 0 && (
				<div className="mt-3 flex flex-wrap gap-2">
					<CategoryChip
						active={!categoryId}
						label="Tutte"
						onClick={() =>
							navigate({
								search: (prev) => ({ ...prev, categoryId: undefined }),
								replace: true,
							})
						}
					/>
					{categories.map((c) => (
						<CategoryChip
							key={c.id}
							active={categoryId === c.id}
							label={c.name}
							onClick={() =>
								navigate({
									search: (prev) => ({ ...prev, categoryId: c.id }),
									replace: true,
								})
							}
						/>
					))}
				</div>
			)}

			<div className="mt-6">
				{isPending ? (
					<div className={GRID} aria-hidden>
						{Array.from({ length: 8 }, (_, i) => (
							<TileSkeleton key={`tile-skeleton-${i}`} />
						))}
					</div>
				) : isError ? (
					<Notice
						icon={RotateCw}
						title="Non siamo riusciti a caricare i negozi"
						description="Qualcosa è andato storto. Riprova tra un momento."
						action={
							<Button variant="secondary" size="sm" onClick={() => refetch()}>
								<RotateCw className="size-4" aria-hidden />
								Riprova
							</Button>
						}
					/>
				) : stores.length === 0 ? (
					<Notice
						icon={Compass}
						title={hasQuery ? "Nessun risultato" : "Esplora i negozi"}
						description={
							hasQuery
								? "Nessun negozio corrisponde alla tua ricerca. Prova con un altro nome o comune."
								: "Non ci sono ancora negozi da mostrare. Torna a trovarci presto."
						}
					/>
				) : (
					<>
						<ul className={GRID}>
							{stores.map((store) => (
								<li key={store.id}>
									<StoreTile
										store={store}
										showDistance={geoStatus === "granted"}
									/>
								</li>
							))}
						</ul>
						{hasNextPage && (
							<div className="mt-8 flex justify-center">
								<Button
									variant="secondary"
									onClick={() => fetchNextPage()}
									disabled={isFetchingNextPage}
								>
									{isFetchingNextPage ? "Caricamento…" : "Carica altri"}
								</Button>
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}

function CategoryChip({
	active,
	label,
	onClick,
}: {
	active: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`rounded-full border px-3 py-1 text-sm transition-colors ${
				active
					? "border-primary bg-primary text-primary-foreground"
					: "border-border bg-background text-muted-foreground hover:text-foreground"
			}`}
		>
			{label}
		</button>
	);
}
