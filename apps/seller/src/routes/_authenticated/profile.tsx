import { createFileRoute } from "@tanstack/react-router";
import { BusinessInfoCard } from "@/features/profile/components/business-info-card";
import { PersonalInfoCard } from "@/features/profile/components/personal-info-card";
import { useIsOwner } from "@/hooks/use-is-owner";

export const Route = createFileRoute("/_authenticated/profile")({
	component: ProfilePage,
});

function ProfilePage() {
	const isOwner = useIsOwner();
	return (
		<div className="mx-auto flex max-w-4xl flex-col gap-8">
			<header className="space-y-1">
				<h1 className="font-display text-2xl font-semibold tracking-tight">
					Profilo
				</h1>
				<p className="text-sm text-muted-foreground">
					Dati personali e informazioni dell'azienda.
				</p>
			</header>
			<PersonalInfoCard />
			<BusinessInfoCard readOnly={!isOwner} />
		</div>
	);
}
