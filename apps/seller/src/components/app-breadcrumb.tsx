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
import { m } from "@/paraglide/messages";

// Funzioni e non stringhe: le etichette vanno lette a ogni render, dopo un
// cambio di lingua. I segmenti senza etichetta si mostrano così come sono.
const SEGMENT_LABEL: Record<string, () => string> = {
	products: m.shell_nav_products,
	orders: m.shell_nav_orders,
	pickup: m.shell_nav_pickup,
	promotions: m.shell_nav_promotions,
	store: m.shell_crumb_store,
	team: m.shell_crumb_team,
	profile: m.shell_crumb_profile,
	onboarding: m.shell_crumb_onboarding,
	new: m.shell_crumb_new,
	company: m.shell_crumb_company,
	document: m.shell_crumb_document,
	payment: m.shell_crumb_payment,
	"personal-info": m.shell_crumb_personal_info,
	pending: m.shell_crumb_pending,
	archived: m.shell_nav_archive,
	closures: m.shell_crumb_closures,
	billing: m.shell_nav_billing,
	// `payment` è lo step dell'onboarding, `payments` le pagine di ritorno da Stripe.
	payments: m.shell_crumb_payments,
	return: m.shell_crumb_return,
	refresh: m.shell_crumb_refresh,
	processing: m.shell_crumb_processing,
};

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function labelFor(segment: string): string {
	if (UUID_RE.test(segment)) return m.shell_crumb_detail();
	return SEGMENT_LABEL[segment]?.() ?? segment;
}

export function buildCrumbs(pathname: string) {
	const segments = pathname.split("/").filter(Boolean);
	const crumbs: { label: string; href: string }[] = [];
	let acc = "";
	for (const seg of segments) {
		acc += `/${seg}`;
		crumbs.push({ label: labelFor(seg), href: acc });
	}
	return crumbs;
}

export function AppBreadcrumb() {
	const pathname = useLocation({ select: (s) => s.pathname });
	const crumbs = buildCrumbs(pathname);
	const atHome = crumbs.length === 0;

	return (
		<Breadcrumb>
			<BreadcrumbList>
				<BreadcrumbItem>
					{atHome ? (
						<BreadcrumbPage>{m.shell_nav_home()}</BreadcrumbPage>
					) : (
						<BreadcrumbLink asChild>
							<Link to="/">{m.shell_nav_home()}</Link>
						</BreadcrumbLink>
					)}
				</BreadcrumbItem>
				{crumbs.map((c, i) => {
					const isLast = i === crumbs.length - 1;
					return (
						<Fragment key={c.href}>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								{isLast ? (
									<BreadcrumbPage>{c.label}</BreadcrumbPage>
								) : (
									<BreadcrumbLink asChild>
										{/* `to` is typed as a route union; safe cast for built paths. */}
										<Link to={c.href as never}>{c.label}</Link>
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
