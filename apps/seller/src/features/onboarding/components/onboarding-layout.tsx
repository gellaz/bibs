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
import { authClient } from "@/lib/auth-client";
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

	const handleLogout = async () => {
		await authClient.signOut();
		void navigate({ to: "/login" });
	};

	return (
		<div className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
			<div className="w-full max-w-lg">
				<OnboardingStepper currentStatus={currentStatus} />
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
								Esci
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
