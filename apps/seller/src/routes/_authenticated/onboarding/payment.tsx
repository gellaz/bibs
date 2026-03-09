import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@bibs/ui/components/alert-dialog";
import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CreditCardIcon } from "lucide-react";
import { useState } from "react";
import { OnboardingLayout } from "@/features/onboarding/components/onboarding-layout";
import { useGoBack, useUpdatePayment } from "@/hooks/use-onboarding";

export const Route = createFileRoute("/_authenticated/onboarding/payment")({
	component: PaymentPage,
});

function PaymentPage() {
	const navigate = useNavigate();
	const mutation = useUpdatePayment();
	const goBackMutation = useGoBack();
	const [apiError, setApiError] = useState("");

	async function handleSubmit() {
		setApiError("");
		try {
			// For now, skip Stripe Connect and submit without an account ID.
			// In production this will initiate Stripe Connect onboarding.
			await mutation.mutateAsync({});
			void navigate({ to: "/onboarding/pending" });
		} catch (err) {
			setApiError(
				err instanceof Error ? err.message : "Errore durante il salvataggio",
			);
		}
	}

	return (
		<OnboardingLayout
			currentStatus="pending_payment"
			title="Metodo di pagamento"
			description="Configura come ricevere i pagamenti"
		>
			<div className="flex flex-col gap-4">
				{apiError && (
					<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{apiError}
					</div>
				)}

				<Card>
					<CardHeader className="flex flex-row items-center gap-3 pb-2">
						<div className="flex size-10 items-center justify-center rounded-lg bg-muted">
							<CreditCardIcon className="size-5 text-muted-foreground" />
						</div>
						<div>
							<CardTitle className="text-base">Stripe Connect</CardTitle>
							<CardDescription>
								Ricevi pagamenti tramite carta di credito e PayPal
							</CardDescription>
						</div>
					</CardHeader>
					<CardContent>
						<p className="text-sm text-muted-foreground">
							L'integrazione con Stripe verrà configurata in fase di
							attivazione. Per ora, completa la registrazione e il tuo account
							verrà attivato da un amministratore.
						</p>
					</CardContent>
				</Card>

				<div className="mt-2 flex flex-col gap-2 sm:flex-row-reverse">
					<Button
						onClick={handleSubmit}
						disabled={mutation.isPending || goBackMutation.isPending}
						className="flex-1"
					>
						{mutation.isPending ? "Invio in corso..." : "Invia registrazione"}
					</Button>
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button
								variant="outline"
								disabled={mutation.isPending || goBackMutation.isPending}
								className="flex-1"
							>
								{goBackMutation.isPending ? "Attendere..." : "Indietro"}
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Tornare indietro?</AlertDialogTitle>
								<AlertDialogDescription>
									Il metodo di pagamento configurato verrà eliminato.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Annulla</AlertDialogCancel>
								<AlertDialogAction
									onClick={async () => {
										try {
											await goBackMutation.mutateAsync(undefined);
											void navigate({ to: "/onboarding/team" });
										} catch (err) {
											setApiError(
												err instanceof Error ? err.message : "Errore",
											);
										}
									}}
								>
									Conferma
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>
			</div>
		</OnboardingLayout>
	);
}
