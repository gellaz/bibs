import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { Spinner } from "@bibs/ui/components/spinner";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ClockIcon, MailIcon, XCircleIcon } from "lucide-react";
import { useOnboardingStatus } from "@/hooks/use-onboarding";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_authenticated/onboarding/pending")({
	component: PendingPage,
});

function PendingPage() {
	const navigate = useNavigate();
	const { data: onboarding, isLoading } = useOnboardingStatus();

	const handleLogout = async () => {
		await authClient.signOut();
		void navigate({ to: "/login" });
	};

	if (isLoading) {
		return (
			<div className="flex h-screen items-center justify-center">
				<Spinner className="size-8" />
			</div>
		);
	}

	const status = onboarding?.onboardingStatus;
	const isPendingEmail = status === "pending_email";
	const isRejected = status === "rejected";

	let icon = <ClockIcon className="size-6" />;
	let title = m.onboarding_pending_review_title();
	let description = m.onboarding_pending_review_body();

	if (isPendingEmail) {
		icon = <MailIcon className="size-6" />;
		title = m.onboarding_pending_email_title();
		description = m.onboarding_pending_email_body();
	} else if (isRejected) {
		icon = <XCircleIcon className="size-6" />;
		title = m.onboarding_pending_rejected_title();
		description = m.onboarding_pending_rejected_body();
	}

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-md">
				<CardHeader className="text-center">
					<div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
						{icon}
					</div>
					<CardTitle className="text-xl">{title}</CardTitle>
					<CardDescription>{description}</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{isPendingEmail && (
						<p className="text-center text-sm text-muted-foreground">
							{m.onboarding_pending_email_spam()}
						</p>
					)}

					{!isPendingEmail && !isRejected && (
						<p className="text-center text-sm text-muted-foreground">
							{m.onboarding_pending_review_eta()}
						</p>
					)}

					<div className="border-t pt-4">
						<Button onClick={handleLogout} variant="outline" className="w-full">
							{m.common_sign_out()}
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
