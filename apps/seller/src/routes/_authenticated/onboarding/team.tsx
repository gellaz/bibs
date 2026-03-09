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
import { Badge } from "@bibs/ui/components/badge";
import { Button } from "@bibs/ui/components/button";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MailIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { OnboardingLayout } from "@/features/onboarding/components/onboarding-layout";
import {
	useCompleteTeam,
	useGoBack,
	useInviteTeamMember,
	useOnboardingInvitations,
} from "@/hooks/use-onboarding";

export const Route = createFileRoute("/_authenticated/onboarding/team")({
	component: TeamPage,
});

function TeamPage() {
	const navigate = useNavigate();
	const inviteMutation = useInviteTeamMember();
	const completeMutation = useCompleteTeam();
	const goBackMutation = useGoBack();
	const { data: invitations = [], isLoading } = useOnboardingInvitations();

	const [email, setEmail] = useState("");
	const [apiError, setApiError] = useState("");
	const [successMsg, setSuccessMsg] = useState("");

	const isSubmitting =
		inviteMutation.isPending ||
		completeMutation.isPending ||
		goBackMutation.isPending;

	async function handleInvite(e: React.FormEvent) {
		e.preventDefault();
		setApiError("");
		setSuccessMsg("");

		if (!email.trim()) return;

		try {
			await inviteMutation.mutateAsync({ email: email.trim() });
			setEmail("");
			setSuccessMsg("Invito inviato!");
			setTimeout(() => setSuccessMsg(""), 5000);
		} catch (err) {
			setApiError(
				err instanceof Error ? err.message : "Errore durante l'invio",
			);
		}
	}

	async function handleComplete() {
		setApiError("");
		try {
			await completeMutation.mutateAsync(undefined);
			void navigate({ to: "/onboarding/payment" });
		} catch (err) {
			setApiError(
				err instanceof Error ? err.message : "Errore durante il salvataggio",
			);
		}
	}

	async function handleGoBack() {
		setApiError("");
		try {
			await goBackMutation.mutateAsync(undefined);
			void navigate({ to: "/onboarding/store" });
		} catch (err) {
			setApiError(err instanceof Error ? err.message : "Errore");
		}
	}

	return (
		<OnboardingLayout
			currentStatus="pending_team"
			title="Invita il tuo team"
			description="Aggiungi collaboratori che potranno gestire prodotti, ordini e magazzino. Questo step è facoltativo."
		>
			<div className="flex flex-col gap-4">
				{apiError && (
					<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{apiError}
					</div>
				)}
				{successMsg && (
					<div className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700">
						{successMsg}
					</div>
				)}

				<form onSubmit={handleInvite} className="flex gap-2">
					<div className="flex-1">
						<Label htmlFor="email" className="sr-only">
							Email collaboratore
						</Label>
						<Input
							id="email"
							type="email"
							placeholder="email@esempio.com"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							disabled={isSubmitting}
						/>
					</div>
					<Button type="submit" disabled={isSubmitting || !email.trim()}>
						<MailIcon className="mr-2 size-4" />
						{inviteMutation.isPending ? "Invio..." : "Invita"}
					</Button>
				</form>

				{/* Invited list */}
				{!isLoading && invitations.length > 0 && (
					<div className="rounded-lg border">
						<div className="flex items-center gap-2 border-b px-3 py-2">
							<UsersIcon className="size-4 text-muted-foreground" />
							<span className="text-sm font-medium">
								Inviti inviati ({invitations.length})
							</span>
						</div>
						<ul className="divide-y">
							{invitations.map((inv) => (
								<li
									key={inv.id}
									className="flex items-center justify-between px-3 py-2"
								>
									<span className="text-sm">{inv.email}</span>
									<Badge
										variant={
											inv.status === "accepted"
												? "default"
												: inv.status === "expired"
													? "destructive"
													: "secondary"
										}
									>
										{inv.status === "pending"
											? "In attesa"
											: inv.status === "accepted"
												? "Accettato"
												: "Scaduto"}
									</Badge>
								</li>
							))}
						</ul>
					</div>
				)}

				<div className="mt-2 flex flex-col gap-2 sm:flex-row-reverse">
					<Button
						onClick={handleComplete}
						disabled={isSubmitting}
						className="flex-1"
					>
						{completeMutation.isPending
							? "Salvataggio..."
							: invitations.length > 0
								? "Continua"
								: "Salta e continua"}
					</Button>
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button
								variant="outline"
								disabled={isSubmitting}
								className="flex-1"
							>
								{goBackMutation.isPending ? "Attendere..." : "Indietro"}
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Tornare indietro?</AlertDialogTitle>
								<AlertDialogDescription>
									I negozi creati verranno eliminati e dovrai ricrearli.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Annulla</AlertDialogCancel>
								<AlertDialogAction onClick={handleGoBack}>
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
