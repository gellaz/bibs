import { CreateButton } from "@bibs/ui/custom/create-button";
import { PageHeader } from "@bibs/ui/custom/page-header";
import { createFileRoute } from "@tanstack/react-router";
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
