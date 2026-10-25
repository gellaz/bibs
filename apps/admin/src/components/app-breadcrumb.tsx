import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@bibs/ui/components/breadcrumb";
import { Link, useLocation } from "@tanstack/react-router";
import { Fragment } from "react";
import { configurationSections } from "@/features/configurations/sections";
import { m } from "@/paraglide/messages";

// Funzioni e non stringhe: le etichette vanno lette a ogni render, dopo un
// cambio di lingua. I segmenti senza etichetta si mostrano così come sono.
const SEGMENT_LABEL: Record<string, () => string> = {
	users: m.common_users,
	sellers: m.common_sellers,
	stores: m.common_stores,
	products: m.common_products,
	collections: m.common_revenue,
	billing: m.billing_title,
	pricing: m.billing_tab_pricing,
	subscriptions: m.billing_tab_subscriptions,
	profile: m.shell_crumb_profile,
	configurations: m.configurations_title,
	requests: m.requests_title,
};

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function labelFor(segment: string, parent?: string): string {
	if (UUID_RE.test(segment)) return m.shell_crumb_detail();
	// Le voci delle configurazioni prendono il titolo della pagina, non lo slug.
	if (parent === "configurations") {
		const section = configurationSections.find((s) => s.slug === segment);
		if (section) return section.title();
	}
	return SEGMENT_LABEL[segment]?.() ?? segment;
}

export function buildCrumbs(pathname: string) {
	const segments = pathname.split("/").filter(Boolean);
	const crumbs: { label: string; href: string }[] = [];
	let acc = "";
	segments.forEach((seg, i) => {
		acc += `/${seg}`;
		crumbs.push({ label: labelFor(seg, segments[i - 1]), href: acc });
	});
	return crumbs;
}

export function AppBreadcrumb() {
	const pathname = useLocation({ select: (s) => s.pathname });
	const crumbs = buildCrumbs(pathname);
	const atHome = crumbs.length === 0;

	// Su una riga: a 390 px i titoli lunghi delle voci andrebbero a capo
	// nell'header alto 48 px. L'ultima voce si tronca, il titolo intero è nell'h1.
	return (
		<Breadcrumb className="min-w-0">
			<BreadcrumbList className="flex-nowrap">
				<BreadcrumbItem>
					{atHome ? (
						<BreadcrumbPage>{m.shell_nav_home()}</BreadcrumbPage>
					) : (
						<BreadcrumbLink render={<Link to="/" />}>
							{m.shell_nav_home()}
						</BreadcrumbLink>
					)}
				</BreadcrumbItem>
				{crumbs.map((c, i) => {
					const isLast = i === crumbs.length - 1;
					return (
						<Fragment key={c.href}>
							<BreadcrumbSeparator />
							<BreadcrumbItem className={isLast ? "min-w-0" : undefined}>
								{isLast ? (
									<BreadcrumbPage className="truncate">
										{c.label}
									</BreadcrumbPage>
								) : (
									<BreadcrumbLink
										// `to` is typed as a route union; safe cast for built paths.
										render={<Link to={c.href as never} />}
									>
										{c.label}
									</BreadcrumbLink>
								)}
							</BreadcrumbItem>
						</Fragment>
					);
				})}
			</BreadcrumbList>
		</Breadcrumb>
	);
}
