import { Button } from "@bibs/ui/components/button";
import { Skeleton } from "@bibs/ui/components/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Compass, RotateCw } from "lucide-react";
import { NoticePage } from "@/components/notice";
import { PAGE_CONTAINER } from "@/components/page";
import { ProductCharacteristics } from "@/features/products/product-characteristics";
import { ProductGallery } from "@/features/products/product-gallery";
import { ProductOffer } from "@/features/products/product-offer";
import { useProductDetail } from "@/features/products/use-product-detail";
import { m } from "@/paraglide/messages";

interface ProductDetailSearch {
	/** Il negozio da cui arriva il cliente. Mai coordinate nell'URL. */
	store?: string;
}

export const Route = createFileRoute("/_authenticated/products/$productId")({
	validateSearch: (search: Record<string, unknown>): ProductDetailSearch => ({
		store: typeof search.store === "string" ? search.store : undefined,
	}),
	component: ProductDetailPage,
});

/**
 * Foto a sinistra e, da `lg`, colonna di acquisto a destra; sotto `lg` tutto
 * si impila: foto, nome, prezzo e negozio, poi descrizione e caratteristiche.
 */
const LAYOUT_GRID =
	"grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] xl:gap-x-14";

function ProductDetailSkeleton() {
	return (
		<div className={`${PAGE_CONTAINER} py-8 sm:py-10`}>
			<div className={LAYOUT_GRID}>
				<Skeleton className="aspect-square w-full" />
				<div className="space-y-4">
					<Skeleton className="h-8 w-3/4" />
					<Skeleton className="h-6 w-24" />
					<Skeleton className="h-32 w-full" />
				</div>
			</div>
		</div>
	);
}

function ProductDetailPage() {
	const { productId } = Route.useParams();
	const { store } = Route.useSearch();
	const {
		data: product,
		isPending,
		isError,
		refetch,
	} = useProductDetail(productId, store);

	if (isPending) return <ProductDetailSkeleton />;

	if (isError) {
		return (
			<NoticePage
				icon={RotateCw}
				title={m.product_detail_load_error_title()}
				description={m.product_detail_load_error_description()}
				action={
					<Button variant="secondary" size="sm" onClick={() => refetch()}>
						<RotateCw className="size-4" aria-hidden />
						{m.product_detail_retry()}
					</Button>
				}
			/>
		);
	}

	if (!product) {
		return (
			<NoticePage
				icon={Compass}
				title={m.product_detail_not_found_title()}
				description={m.product_detail_not_found_description()}
				action={
					<Button asChild variant="secondary" size="sm">
						<Link to="/products">{m.product_detail_back_to_products()}</Link>
					</Button>
				}
			/>
		);
	}

	const kicker = [product.brandName, product.category?.name]
		.filter(Boolean)
		.join(" · ");

	return (
		<div className={`${PAGE_CONTAINER} py-8 sm:py-10`}>
			<div className={LAYOUT_GRID}>
				<ProductGallery
					key={product.id}
					images={product.images}
					name={product.name}
				/>

				<div className="min-w-0 space-y-6">
					<header className="space-y-2">
						{kicker && (
							<p className="text-muted-foreground text-sm">{kicker}</p>
						)}
						<h1 className="font-bold font-display text-[clamp(1.625rem,3vw,2.125rem)] text-foreground leading-[1.18] tracking-[-0.015em] break-words">
							{product.name}
						</h1>
					</header>

					<ProductOffer product={product} />
				</div>

				<div className="min-w-0 space-y-10 lg:col-span-2 lg:max-w-3xl">
					{product.description && (
						<section className="space-y-3">
							<h2 className="font-display font-semibold text-foreground text-lg">
								{m.product_detail_description_title()}
							</h2>
							<p className="max-w-[65ch] whitespace-pre-line text-foreground leading-relaxed">
								{product.description}
							</p>
						</section>
					)}
					<ProductCharacteristics characteristics={product.characteristics} />
				</div>
			</div>
		</div>
	);
}
