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
		<div className="mx-auto flex max-w-2xl flex-col gap-4">
			<PersonalInfoCard />
			<BusinessInfoCard readOnly={!isOwner} />
		</div>
	);
}
