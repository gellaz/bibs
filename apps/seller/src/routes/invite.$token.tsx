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
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircleIcon } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";

export const Route = createFileRoute("/invite/$token")({
	component: AcceptInvitePage,
});

function AcceptInvitePage() {
	const { token } = Route.useParams();

	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [apiError, setApiError] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [success, setSuccess] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setApiError("");

		if (password.length < 8) {
			setApiError("La password deve avere almeno 8 caratteri");
			return;
		}

		if (password !== confirmPassword) {
			setApiError("Le password non coincidono");
			return;
		}

		setIsSubmitting(true);
		try {
			const response = await api().register["accept-invite"].post({
				token,
				password,
				confirmPassword,
			});

			if (response.error) {
				const errorMsg =
					typeof response.error.value === "string"
						? response.error.value
						: "Errore durante la creazione dell'account";
				setApiError(errorMsg);
				return;
			}

			setSuccess(true);
		} catch {
			setApiError("Errore di rete. Riprova.");
		} finally {
			setIsSubmitting(false);
		}
	}

	if (success) {
		return (
			<div className="flex min-h-screen items-center justify-center px-4">
				<Card className="w-full max-w-sm text-center">
					<CardHeader>
						<div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-green-100">
							<CheckCircleIcon className="size-6 text-green-600" />
						</div>
						<CardTitle className="text-xl">Account creato!</CardTitle>
						<CardDescription>
							Il tuo account è stato creato con successo.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Link to="/login" className="text-sm text-primary underline">
							Vai al login
						</Link>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="flex min-h-screen items-center justify-center px-4">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground text-lg font-bold">
						B
					</div>
					<CardTitle className="text-xl">Crea la tua password</CardTitle>
					<CardDescription>
						Sei stato invitato a collaborare su Bibs. Scegli una password per
						completare la registrazione.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{apiError && (
						<div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{apiError}
						</div>
					)}

					<form onSubmit={handleSubmit} className="flex flex-col gap-4">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="password">Password</Label>
							<Input
								id="password"
								type="password"
								placeholder="Minimo 8 caratteri"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								disabled={isSubmitting}
								minLength={8}
								required
							/>
						</div>

						<div className="flex flex-col gap-1.5">
							<Label htmlFor="confirmPassword">Conferma password</Label>
							<Input
								id="confirmPassword"
								type="password"
								placeholder="Ripeti la password"
								value={confirmPassword}
								onChange={(e) => setConfirmPassword(e.target.value)}
								disabled={isSubmitting}
								minLength={8}
								required
							/>
						</div>

						<Button type="submit" disabled={isSubmitting} className="w-full">
							{isSubmitting ? "Creazione in corso..." : "Crea account"}
						</Button>
					</form>

					<p className="mt-4 text-center text-sm text-muted-foreground">
						Hai già un account?{" "}
						<Link to="/login" className="text-primary underline">
							Accedi
						</Link>
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
