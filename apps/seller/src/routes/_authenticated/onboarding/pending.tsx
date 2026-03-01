import { Button } from "@bibs/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@bibs/ui/components/card";
import { Input } from "@bibs/ui/components/input";
import { Label } from "@bibs/ui/components/label";
import { Spinner } from "@bibs/ui/components/spinner";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useSellerProfile, useUpdateVat } from "@/hooks/use-seller-profile";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authenticated/onboarding/pending")({
	component: PendingVerificationPage,
});

function PendingVerificationPage() {
	const navigate = useNavigate();
	const { data: profile, isLoading } = useSellerProfile();
	const updateVat = useUpdateVat();
	const [vatNumber, setVatNumber] = useState("");
	const [error, setError] = useState("");

	const handleLogout = async () => {
		await authClient.signOut();
		void navigate({ to: "/login" });
	};

	const handleResubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");

		// Validate VAT format (11 digits)
		if (!/^\d{11}$/.test(vatNumber)) {
			setError("La partita IVA deve essere di 11 cifre numeriche");
			return;
		}

		try {
			await updateVat.mutateAsync(vatNumber);
			setVatNumber("");
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Errore durante l'aggiornamento della partita IVA",
			);
		}
	};

	if (isLoading) {
		return (
			<div className="flex h-screen items-center justify-center">
				<Spinner className="size-8" />
			</div>
		);
	}

	if (!profile) {
		return (
			<div className="flex h-screen items-center justify-center">
				<Card className="w-full max-w-md">
					<CardHeader className="text-center">
						<CardTitle>Errore</CardTitle>
						<CardDescription>
							Impossibile caricare il profilo venditore
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button onClick={handleLogout} className="w-full">
							Torna al login
						</Button>
					</CardContent>
				</Card>
			</div>
		);
	}

	const isRejected = profile.vatStatus === "rejected";
	const isPending = profile.vatStatus === "pending";

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-md">
				<CardHeader className="text-center">
					<div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground text-lg font-bold">
						B
					</div>
					<CardTitle>
						{isRejected ? "Partita IVA rifiutata" : "Verifica in corso"}
					</CardTitle>
					<CardDescription>
						{isRejected
							? "La tua partita IVA è stata rifiutata. Inserisci una nuova partita IVA per riprovare."
							: "La tua partita IVA verrà verificata dagli amministratori in 1-2 giorni lavorativi"}
					</CardDescription>
				</CardHeader>

				<CardContent className="flex flex-col gap-4">
					{!isRejected && (
						<div className="rounded-lg bg-muted px-4 py-3">
							<p className="text-sm text-muted-foreground">
								Partita IVA inviata:
							</p>
							<p className="font-mono text-lg font-semibold">
								{profile.vatNumber}
							</p>
						</div>
					)}

					{isRejected && (
						<form onSubmit={handleResubmit} className="flex flex-col gap-4">
							{error && (
								<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
									{error}
								</div>
							)}

							<div className="flex flex-col gap-2">
								<Label htmlFor="vatNumber">Nuova Partita IVA</Label>
								<Input
									id="vatNumber"
									type="text"
									placeholder="12345678901"
									value={vatNumber}
									onChange={(e) => setVatNumber(e.target.value)}
									maxLength={11}
									pattern="\d{11}"
									required
									autoFocus
								/>
								<p className="text-xs text-muted-foreground">
									Inserisci la tua partita IVA italiana (11 cifre)
								</p>
							</div>

							<Button
								type="submit"
								disabled={updateVat.isPending}
								className="w-full"
							>
								{updateVat.isPending
									? "Invio in corso..."
									: "Invia nuova partita IVA"}
							</Button>
						</form>
					)}

					{isPending && updateVat.isSuccess && (
						<div className="rounded-md bg-green-50 dark:bg-green-950 px-3 py-2 text-sm text-green-700 dark:text-green-300">
							Partita IVA aggiornata con successo! La verifica è ora in corso.
						</div>
					)}

					<div className="border-t pt-4">
						<Button onClick={handleLogout} variant="outline" className="w-full">
							Esci
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
