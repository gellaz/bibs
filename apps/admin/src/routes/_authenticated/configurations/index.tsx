import { Badge } from "@bibs/ui/components/badge";
import { PageHeader } from "@bibs/ui/custom/page-header";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import {
	configurationGroups,
	configurationSections,
} from "@/features/configurations/sections";
import { api } from "@/lib/api";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/configurations/")({
	component: ConfigurationsPage,
});

function ConfigurationsPage() {
	const { data: counts } = useQuery({
		queryKey: ["admin-configurations-counts"],
		queryFn: async () => {
			const response = await api().admin.configurations.counts.get();
			if (response.error) return null;
			return response.data?.data ?? null;
		},
	});

	return (
		<div className="space-y-8">
			<PageHeader
				title={m.configurations_title()}
				description={m.configurations_description()}
			/>

			{configurationGroups.map((group) => (
				<section
					key={group.id}
					aria-labelledby={`configurations-${group.id}`}
					className="space-y-3"
				>
					<h2
						id={`configurations-${group.id}`}
						className="font-display text-lg font-semibold tracking-tight"
					>
						{group.label()}
					</h2>
					<ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
						{configurationSections
							.filter((section) => section.group === group.id)
							.map((section) => {
								const count = section.countKey
									? counts?.[section.countKey]
									: undefined;
								return (
									<li key={section.slug}>
										<Link
											to="/configurations/$section"
											params={{ section: section.slug }}
											// Riga compatta su telefono, blocco con l'icona in alto da sm.
											className="group/config bg-card grid h-full grid-cols-[auto_1fr_auto] items-start gap-x-4 rounded-lg border p-4 transition-shadow duration-200 ease-out hover:shadow-xs sm:grid-cols-[1fr_auto] sm:grid-rows-[auto_1fr] sm:gap-y-5 sm:p-6"
										>
											<span className="bg-cobalt-soft text-cobalt-deep dark:text-cobalt flex size-10 items-center justify-center rounded-lg">
												<section.icon aria-hidden className="size-5" />
											</span>
											<ArrowRightIcon
												aria-hidden
												className="text-muted-foreground group-hover/config:text-foreground size-4 self-center transition-[color,translate] duration-200 ease-out group-hover/config:translate-x-0.5 motion-reduce:transition-none max-sm:order-last sm:self-start"
											/>
											<span className="min-w-0 space-y-1 sm:col-span-2">
												<span className="flex items-center gap-2">
													<span className="font-medium">
														{section.cardTitle()}
													</span>
													{count !== undefined && (
														// Cobalt Pill (DESIGN.md): i conteggi operativi.
														<Badge className="bg-cobalt-soft text-cobalt-deep dark:text-cobalt tabular-nums">
															{count}
														</Badge>
													)}
												</span>
												<span className="text-muted-foreground block text-sm leading-relaxed">
													{section.description()}
												</span>
											</span>
										</Link>
									</li>
								);
							})}
					</ul>
				</section>
			))}
		</div>
	);
}
