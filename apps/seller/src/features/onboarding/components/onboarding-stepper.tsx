import {
	Stepper,
	StepperIndicator,
	StepperItem,
	StepperTitle,
} from "@bibs/ui/custom/stepper";
import type { OnboardingStatus } from "@/db/schemas/seller";
import { m } from "@/paraglide/messages";

const STEPS = [
	{ key: "pending_personal", label: m.onboarding_step_personal },
	{ key: "pending_document", label: m.onboarding_step_document },
	{ key: "pending_company", label: m.onboarding_step_company },
	{ key: "pending_review", label: m.onboarding_step_review },
	{ key: "first_store", label: m.onboarding_step_store },
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
		<Stepper
			activeStep={getStepIndex(currentStatus)}
			aria-label={m.onboarding_stepper_label()}
			className="mb-8"
		>
			{STEPS.map((step) => (
				<StepperItem key={step.key}>
					<StepperIndicator />
					<StepperTitle>{step.label()}</StepperTitle>
				</StepperItem>
			))}
		</Stepper>
	);
}

export { type OnboardingStatus, STEPS };
