import { cn } from "@bibs/ui/lib/utils";
import { CheckIcon } from "lucide-react";

const STEPS = [
	{ key: "pending_personal", label: "Anagrafica" },
	{ key: "pending_document", label: "Documento" },
	{ key: "pending_company", label: "Azienda" },
	{ key: "pending_store", label: "Negozio" },
	{ key: "pending_payment", label: "Pagamento" },
] as const;

type OnboardingStatus =
	| "pending_email"
	| "pending_personal"
	| "pending_document"
	| "pending_company"
	| "pending_store"
	| "pending_payment"
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
	const currentStepIndex = getStepIndex(currentStatus);

	return (
		<nav aria-label="Onboarding progress" className="mb-8">
			<ol className="flex items-center gap-2">
				{STEPS.map((step, index) => {
					const isCompleted = index < currentStepIndex;
					const isCurrent = index === currentStepIndex;

					return (
						<li key={step.key} className="flex flex-1 items-center gap-2">
							<div className="flex flex-col items-center gap-1.5 flex-1">
								<div
									className={cn(
										"flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-medium transition-colors",
										isCompleted &&
											"border-primary bg-primary text-primary-foreground",
										isCurrent && "border-primary bg-background text-primary",
										!isCompleted &&
											!isCurrent &&
											"border-muted-foreground/30 bg-background text-muted-foreground/50",
									)}
								>
									{isCompleted ? <CheckIcon className="size-4" /> : index + 1}
								</div>
								<span
									className={cn(
										"text-xs text-center hidden sm:block",
										isCurrent
											? "font-medium text-foreground"
											: "text-muted-foreground",
									)}
								>
									{step.label}
								</span>
							</div>
							{index < STEPS.length - 1 && (
								<div
									className={cn(
										"h-0.5 flex-1 rounded-full mb-5 sm:mb-0",
										index < currentStepIndex
											? "bg-primary"
											: "bg-muted-foreground/20",
									)}
								/>
							)}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}

export { STEPS, type OnboardingStatus };
