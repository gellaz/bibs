import { Alert, AlertDescription, AlertTitle } from "@bibs/ui/components/alert";
import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useOnboardingStatus } from "@/hooks/use-onboarding";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";
import { type OnboardingStatus, OnboardingStepper } from "./onboarding-stepper";

interface OnboardingLayoutProps {
	currentStatus: OnboardingStatus;
	title: string;
	description: string;
	children: ReactNode;
}

export function OnboardingLayout({
	currentStatus,
	title,
	description,
	children,
}: OnboardingLayoutProps) {
	const navigate = useNavigate();
	// Set only after a fixable rejection: the admin sent the seller back here.
	const rejectionReason = useOnboardingStatus().data?.rejectionReason;

	const handleLogout = async () => {
		await authClient.signOut();
		void navigate({ to: "/login" });
	};

	return (
		<div className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
			<div className="w-full max-w-lg">
				<OnboardingStepper currentStatus={currentStatus} />
				{rejectionReason && (
					<Alert variant="destructive" className="mb-4">
						<AlertTitle>{m.onboarding_rejected_fix_title()}</AlertTitle>
						<AlertDescription className="whitespace-pre-line">
							{rejectionReason}
						</AlertDescription>
					</Alert>
				)}
				<Card>
					<CardHeader>
						<CardTitle className="text-xl">{title}</CardTitle>
						<CardDescription>{description}</CardDescription>
					</CardHeader>
					<CardContent>
						{children}
						<div className="mt-4 border-t pt-4">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="w-full text-muted-foreground"
								onClick={handleLogout}
							>
								{m.common_sign_out()}
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
