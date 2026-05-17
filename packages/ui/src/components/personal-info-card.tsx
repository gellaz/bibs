"use client";

import * as React from "react";
import {
	AvatarUploadDialog,
	type AvatarUploadDialogLabels,
} from "~/components/avatar-upload-dialog";
import { Button } from "~/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/card";
import { Field, FieldError, FieldLabel } from "~/components/field";
import { Input } from "~/components/input";
import { UserAvatar } from "~/components/user-avatar";
import { cn } from "~/lib/utils";

export interface PersonalInfoCardLabels {
	cardTitle: string;
	cardDescription: string;
	avatarEdit: string;
	firstName: string;
	firstNamePlaceholder: string;
	firstNameRequired: string;
	lastName: string;
	lastNamePlaceholder: string;
	lastNameRequired: string;
	birthDate: string;
	save: string;
	saving: string;
	successUpdate: string;
	errorUpdate: string;
	avatar: AvatarUploadDialogLabels;
}

export interface PersonalInfoCardValues {
	firstName?: string | null;
	lastName?: string | null;
	birthDate?: string | null;
	image?: string | null;
	name?: string | null;
}

export interface PersonalInfoCardProps {
	values: PersonalInfoCardValues;
	onSubmit: (data: {
		firstName: string;
		lastName: string;
		birthDate?: string;
	}) => Promise<{ error?: string }>;
	onUploadAvatar: (file: File) => Promise<void>;
	onRemoveAvatar: () => Promise<void>;
	labels: PersonalInfoCardLabels;
	className?: string;
}

export function PersonalInfoCard({
	values,
	onSubmit,
	onUploadAvatar,
	onRemoveAvatar,
	labels,
	className,
}: PersonalInfoCardProps) {
	const [firstName, setFirstName] = React.useState("");
	const [lastName, setLastName] = React.useState("");
	const [birthDate, setBirthDate] = React.useState("");
	const [touched, setTouched] = React.useState({
		firstName: false,
		lastName: false,
	});
	const [isSubmitting, setIsSubmitting] = React.useState(false);
	const [apiError, setApiError] = React.useState("");
	const [success, setSuccess] = React.useState(false);
	const [dialogOpen, setDialogOpen] = React.useState(false);

	// Sync external values into form
	React.useEffect(() => {
		setFirstName(values.firstName ?? "");
		setLastName(values.lastName ?? "");
		setBirthDate(values.birthDate ?? "");
		setTouched({ firstName: false, lastName: false });
	}, [values.firstName, values.lastName, values.birthDate]);

	const initialValuesKey = `${values.firstName ?? ""}|${values.lastName ?? ""}|${values.birthDate ?? ""}`;
	const currentValuesKey = `${firstName}|${lastName}|${birthDate}`;
	const isDirty = initialValuesKey !== currentValuesKey;

	const firstNameError =
		touched.firstName && !firstName.trim()
			? labels.firstNameRequired
			: undefined;
	const lastNameError =
		touched.lastName && !lastName.trim() ? labels.lastNameRequired : undefined;

	const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setTouched({ firstName: true, lastName: true });
		if (!firstName.trim() || !lastName.trim()) return;

		setApiError("");
		setSuccess(false);
		setIsSubmitting(true);
		try {
			const result = await onSubmit({
				firstName: firstName.trim(),
				lastName: lastName.trim(),
				birthDate: birthDate || undefined,
			});
			if (result.error) {
				setApiError(result.error);
				return;
			}
			setSuccess(true);
		} catch {
			setApiError(labels.errorUpdate);
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<>
			<Card className={cn(className)}>
				<CardHeader>
					<CardTitle>{labels.cardTitle}</CardTitle>
					<CardDescription>{labels.cardDescription}</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="flex flex-col gap-4">
						<div className="flex flex-col items-center gap-2 pb-2">
							<button
								type="button"
								onClick={() => setDialogOpen(true)}
								className="group relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
								aria-label={labels.avatarEdit}
							>
								<UserAvatar
									name={values.name}
									image={values.image}
									className="size-24 text-2xl transition group-hover:opacity-80"
								/>
								<span className="absolute inset-0 hidden items-center justify-center rounded-full bg-black/40 text-xs font-medium text-white group-hover:flex">
									{labels.avatarEdit}
								</span>
							</button>
						</div>

						{apiError && (
							<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
								{apiError}
							</div>
						)}
						{success && (
							<div className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
								{labels.successUpdate}
							</div>
						)}

						<div className="grid grid-cols-2 gap-4">
							<Field data-invalid={!!firstNameError}>
								<FieldLabel htmlFor="firstName" required>
									{labels.firstName}
								</FieldLabel>
								<Input
									id="firstName"
									placeholder={labels.firstNamePlaceholder}
									autoFocus
									value={firstName}
									onChange={(e) => setFirstName(e.target.value)}
									onBlur={() => setTouched((t) => ({ ...t, firstName: true }))}
								/>
								<FieldError
									errors={firstNameError ? [{ message: firstNameError }] : []}
								/>
							</Field>

							<Field data-invalid={!!lastNameError}>
								<FieldLabel htmlFor="lastName" required>
									{labels.lastName}
								</FieldLabel>
								<Input
									id="lastName"
									placeholder={labels.lastNamePlaceholder}
									value={lastName}
									onChange={(e) => setLastName(e.target.value)}
									onBlur={() => setTouched((t) => ({ ...t, lastName: true }))}
								/>
								<FieldError
									errors={lastNameError ? [{ message: lastNameError }] : []}
								/>
							</Field>
						</div>

						<Field>
							<FieldLabel htmlFor="birthDate">{labels.birthDate}</FieldLabel>
							<Input
								id="birthDate"
								type="date"
								value={birthDate}
								onChange={(e) => setBirthDate(e.target.value)}
							/>
						</Field>

						<Button
							type="submit"
							disabled={isSubmitting || !isDirty}
							className="mt-2 w-full"
						>
							{isSubmitting ? labels.saving : labels.save}
						</Button>
					</form>
				</CardContent>
			</Card>

			<AvatarUploadDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				currentImage={values.image}
				name={values.name}
				onUpload={onUploadAvatar}
				onRemove={onRemoveAvatar}
				labels={labels.avatar}
			/>
		</>
	);
}
