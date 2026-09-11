import { Button } from "@bibs/ui/components/button";
import { Field, FieldError, FieldLabel } from "@bibs/ui/components/field";
import { Input } from "@bibs/ui/components/input";
import { toast } from "@bibs/ui/components/sonner";
import { type FormEvent, useEffect, useId, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { m } from "@/paraglide/messages";

/**
 * Anagrafica del cliente. Il gemello di `@bibs/ui/components/personal-info-card`
 * (che resta a seller e admin): qui l'avatar vive nell'intestazione di identità,
 * il salvataggio conferma con un toast come il resto del customer, e i controlli
 * rispettano i 44px del mobile-first. Stessa materia, voce del register brand.
 */
export function PersonalInfoForm() {
	const { data: session } = authClient.useSession();
	const user = session?.user;
	const fieldId = useId();

	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [birthDate, setBirthDate] = useState("");
	const [touched, setTouched] = useState({ firstName: false, lastName: false });
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [apiError, setApiError] = useState("");

	// I valori arrivano dalla sessione, che si aggiorna dopo ogni salvataggio:
	// la form si risincronizza su quelli, non tiene una verità parallela.
	useEffect(() => {
		setFirstName(user?.firstName ?? "");
		setLastName(user?.lastName ?? "");
		setBirthDate(user?.birthDate ?? "");
		setTouched({ firstName: false, lastName: false });
	}, [user?.firstName, user?.lastName, user?.birthDate]);

	const isDirty =
		firstName !== (user?.firstName ?? "") ||
		lastName !== (user?.lastName ?? "") ||
		birthDate !== (user?.birthDate ?? "");

	const firstNameError =
		touched.firstName && !firstName.trim()
			? m.profile_first_name_required()
			: undefined;
	const lastNameError =
		touched.lastName && !lastName.trim()
			? m.profile_last_name_required()
			: undefined;

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setTouched({ firstName: true, lastName: true });
		if (!firstName.trim() || !lastName.trim()) return;

		setApiError("");
		setIsSubmitting(true);
		try {
			const { error } = await authClient.updateUser({
				firstName: firstName.trim(),
				lastName: lastName.trim(),
				// better-auth tipizza i campi additional come string|undefined ma
				// accetta e persiste null quando la chiave è presente nel body
				// (parseInputData scrive data[key] così com'è). Il cast esprime il
				// clear esplicito che il tipo inferito non sa rappresentare.
				birthDate: (birthDate.trim() === "" ? null : birthDate) as unknown as
					| string
					| undefined,
				name: `${firstName.trim()} ${lastName.trim()}`,
			});
			if (error) {
				setApiError(error.message ?? m.profile_error_update());
				return;
			}
			toast.success(m.profile_success_update());
		} catch {
			setApiError(m.profile_error_update());
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<section className="mt-10 sm:mt-12">
			<h2 className="font-semibold text-foreground text-xl tracking-[-0.005em]">
				{m.profile_personal_data()}
			</h2>

			<form
				onSubmit={handleSubmit}
				className="mt-4 rounded-lg border border-border bg-card p-4 sm:p-6"
			>
				{apiError && (
					<p
						role="alert"
						className="mb-5 rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
					>
						{apiError}
					</p>
				)}

				<div className="grid gap-5 sm:grid-cols-2">
					<Field data-invalid={!!firstNameError}>
						<FieldLabel htmlFor={`${fieldId}-first`} required>
							{m.profile_first_name()}
						</FieldLabel>
						<Input
							id={`${fieldId}-first`}
							placeholder={m.profile_first_name_placeholder()}
							value={firstName}
							onChange={(e) => setFirstName(e.target.value)}
							onBlur={() => setTouched((t) => ({ ...t, firstName: true }))}
							aria-invalid={!!firstNameError}
							aria-describedby={
								firstNameError ? `${fieldId}-first-error` : undefined
							}
							className="h-11 sm:h-9"
						/>
						<FieldError
							id={`${fieldId}-first-error`}
							errors={firstNameError ? [{ message: firstNameError }] : []}
						/>
					</Field>

					<Field data-invalid={!!lastNameError}>
						<FieldLabel htmlFor={`${fieldId}-last`} required>
							{m.profile_last_name()}
						</FieldLabel>
						<Input
							id={`${fieldId}-last`}
							placeholder={m.profile_last_name_placeholder()}
							value={lastName}
							onChange={(e) => setLastName(e.target.value)}
							onBlur={() => setTouched((t) => ({ ...t, lastName: true }))}
							aria-invalid={!!lastNameError}
							aria-describedby={
								lastNameError ? `${fieldId}-last-error` : undefined
							}
							className="h-11 sm:h-9"
						/>
						<FieldError
							id={`${fieldId}-last-error`}
							errors={lastNameError ? [{ message: lastNameError }] : []}
						/>
					</Field>
				</div>

				<Field className="mt-5 sm:max-w-56">
					<FieldLabel htmlFor={`${fieldId}-birth`}>
						{m.profile_birth_date()}
					</FieldLabel>
					{/* color-scheme: il calendario nativo è cromo del browser e in dark
					    resterebbe bianco. È l'unico modo per tematizzarlo. */}
					<Input
						id={`${fieldId}-birth`}
						type="date"
						value={birthDate}
						onChange={(e) => setBirthDate(e.target.value)}
						className="h-11 [color-scheme:light] sm:h-9 dark:[color-scheme:dark]"
					/>
				</Field>

				<div className="mt-6 flex flex-col items-stretch gap-3 border-border border-t pt-5 sm:flex-row sm:items-center sm:justify-end">
					<span
						aria-live="polite"
						className="text-center text-muted-foreground text-sm sm:text-left"
					>
						{isDirty && !isSubmitting ? m.profile_unsaved() : ""}
					</span>
					<Button
						type="submit"
						size="lg"
						disabled={isSubmitting || !isDirty}
						className="h-11 px-5 sm:h-9"
					>
						{isSubmitting ? m.profile_saving() : m.profile_save()}
					</Button>
				</div>
			</form>
		</section>
	);
}
