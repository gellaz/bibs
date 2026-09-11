import { createFileRoute, Link } from "@tanstack/react-router";
import { PAGE_CONTAINER } from "@/components/page";
import { NearbyProducts } from "@/features/discovery/nearby-products";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/")({
	component: Home,
});

function Home() {
	const { data: session } = authClient.useSession();
	const firstName =
		session?.user?.firstName ?? session?.user?.name?.split(" ")[0] ?? null;

	return (
		<div className={`${PAGE_CONTAINER} py-8 sm:py-10`}>
			<section>
				<h1 className="text-balance font-bold font-display text-primary text-[clamp(1.75rem,5vw,2.5rem)] leading-[1.1] tracking-[-0.02em]">
					{firstName
						? m.discovery_greeting({ name: firstName })
						: m.discovery_welcome_back()}
				</h1>
				<p className="mt-2 max-w-prose text-balance text-muted-foreground leading-relaxed">
					{m.discovery_home_subtitle()}
				</p>
				<Link
					to="/stores"
					search={{ q: undefined, categoryId: undefined }}
					className="mt-4 inline-flex items-center gap-1.5 font-medium text-primary text-sm hover:underline"
				>
					{m.discovery_explore_all_stores()}
				</Link>
			</section>

			<NearbyProducts />
		</div>
	);
}
