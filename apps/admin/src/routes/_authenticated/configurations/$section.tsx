import { CreateButton } from "@bibs/ui/custom/create-button";
import { PageHeader } from "@bibs/ui/custom/page-header";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { useState } from "react";
import { configurationSections } from "@/features/configurations/sections";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/configurations/$section")(
	{
		component: ConfigurationSectionPage,
		// Cambiando sezione si riparte da zero: pagina, ricerca e dialog aperto.
		remountDeps: ({ params }) => params.section,
	},
);

function ConfigurationSectionPage() {
	const { section: slug } = Route.useParams();
	const [createOpen, setCreateOpen] = useState(false);
	const section = configurationSections.find((s) => s.slug === slug);

	return (
		<div className="space-y-4">
			<Link
				to="/configurations"
				className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
			>
				<ArrowLeftIcon aria-hidden className="size-4" />
				{m.configurations_title()}
			</Link>
			{section ? (
				<>
					<PageHeader
						title={section.title()}
						description={section.description()}
					>
						<CreateButton onClick={() => setCreateOpen(true)}>
							{section.createLabel()}
						</CreateButton>
					</PageHeader>
					{section.render({ createOpen, onCreateOpenChange: setCreateOpen })}
				</>
			) : (
				<p className="text-muted-foreground">{m.shell_not_found()}</p>
			)}
		</div>
	);
}
