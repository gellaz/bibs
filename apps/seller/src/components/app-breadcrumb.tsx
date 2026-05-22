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

const SEGMENT_LABEL: Record<string, string> = {
	products: "Prodotti",
	promotions: "Promozioni",
	store: "Negozio",
	team: "Team",
	profile: "Profilo",
	onboarding: "Onboarding",
	new: "Nuovo",
	company: "Azienda",
	document: "Documento",
	payment: "Pagamento",
	"personal-info": "Dati personali",
	pending: "In attesa",
};

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function labelFor(segment: string): string {
	if (UUID_RE.test(segment)) return "Dettaglio";
	return SEGMENT_LABEL[segment] ?? segment;
}

function buildCrumbs(pathname: string) {
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
						<BreadcrumbPage>Home</BreadcrumbPage>
					) : (
						<BreadcrumbLink asChild>
							<Link to="/">Home</Link>
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
