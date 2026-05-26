import {
	Stepper,
	StepperIndicator,
	StepperItem,
	StepperTitle,
} from "@bibs/ui/components/stepper";

const STEPS = [
	{ key: "pending_personal", label: "Anagrafica" },
	{ key: "pending_document", label: "Documento" },
	{ key: "pending_company", label: "Azienda" },
	{ key: "pending_review", label: "In revisione" },
] as const;

type OnboardingStatus =
	| "pending_email"
	| "pending_personal"
	| "pending_document"
	| "pending_company"
	| "pending_review"
	| "active"
	| "rejected";

function getStepIndex(status: OnboardingStatus): number {
	const idx = STEPS.findIndex((s) => s.key === status);
	// If status is pending_review/active/rejected, all steps are done
	return idx === -1 ? STEPS.length : idx;
}

interface OnboardingStepperProps {
	currentStatus: OnboardingStatus;
}

export function OnboardingStepper({ currentStatus }: OnboardingStepperProps) {
	return (
		<Stepper activeStep={getStepIndex(currentStatus)} className="mb-8">
			{STEPS.map((step) => (
				<StepperItem key={step.key}>
					<StepperIndicator />
					<StepperTitle>{step.label}</StepperTitle>
				</StepperItem>
			))}
		</Stepper>
	);
}

export { type OnboardingStatus, STEPS };
