import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import type { ReactNode } from "react";
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
	return (
		<div className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
			<div className="w-full max-w-lg">
				<OnboardingStepper currentStatus={currentStatus} />
				<Card>
					<CardHeader>
						<CardTitle className="text-xl">{title}</CardTitle>
						<CardDescription>{description}</CardDescription>
					</CardHeader>
					<CardContent>{children}</CardContent>
				</Card>
			</div>
		</div>
	);
}
