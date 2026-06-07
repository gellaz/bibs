import {
	Stepper,
	StepperIndicator,
	StepperItem,
	StepperTitle,
} from "@bibs/ui/components/stepper";
import type { OnboardingStatus } from "@/db/schemas/seller";

const STEPS = [
	{ key: "pending_personal", label: "Anagrafica" },
	{ key: "pending_document", label: "Documento" },
	{ key: "pending_company", label: "Azienda" },
	{ key: "pending_review", label: "In revisione" },
	{ key: "first_store", label: "Negozio" },
] as const;

/**
 * Gli step coprono l'intero percorso di attivazione: gli stati di onboarding
 * documentale più lo pseudo-stato `first_store` (seller verificato, zero
 * negozi) che la pagina /store/new usa in modalità primo negozio.
 */
export type OnboardingStepKey = OnboardingStatus | "first_store";

function getStepIndex(status: OnboardingStepKey): number {
	const idx = STEPS.findIndex((s) => s.key === status);
	// active/rejected non compaiono fra gli step: tutto completato
	return idx === -1 ? STEPS.length : idx;
}

interface OnboardingStepperProps {
	currentStatus: OnboardingStepKey;
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
