import { createFileRoute, Link } from "@tanstack/react-router";
import { NearbyProducts } from "@/features/discovery/nearby-products";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authenticated/")({
	component: Home,
});

function Home() {
	const { data: session } = authClient.useSession();
	const firstName =
		session?.user?.firstName ?? session?.user?.name?.split(" ")[0] ?? null;

	return (
		<div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
			<section>
				<h1 className="text-balance font-bold font-display text-primary text-[clamp(1.75rem,5vw,2.5rem)] leading-[1.1] tracking-[-0.02em]">
					{firstName ? `Ciao, ${firstName}` : "Bentornato su bibs"}
				</h1>
				<p className="mt-2 max-w-prose text-balance text-muted-foreground leading-relaxed">
					Scopri cosa vendono i negozi del tuo quartiere — vicino, oggi.
				</p>
				<Link
					to="/stores"
					search={{ q: undefined, categoryId: undefined }}
					className="mt-4 inline-flex items-center gap-1.5 font-medium text-primary text-sm hover:underline"
				>
					Esplora tutti i negozi →
				</Link>
			</section>

			<NearbyProducts />
		</div>
	);
}
