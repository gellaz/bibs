"use client";

import * as React from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Button } from "~/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/dialog";
import { Slider } from "~/components/slider";
import { toast } from "~/components/sonner";
import { UserAvatar } from "~/components/user-avatar";
import { cropImageToBlob } from "~/lib/crop-image";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export interface AvatarUploadDialogLabels {
	title: string;
	description: string;
	chooseFile: string;
	cropHelp: string;
	save: string;
	cancel: string;
	back: string;
	remove: string;
	errorInvalidType: string;
	errorTooLarge: string;
	errorGeneric: string;
}

export interface AvatarUploadDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	currentImage?: string | null;
	name?: string | null;
	onUpload: (file: File) => Promise<void>;
	onRemove?: () => Promise<void>;
	labels: AvatarUploadDialogLabels;
}

export function AvatarUploadDialog({
	open,
	onOpenChange,
	currentImage,
	name,
	onUpload,
	onRemove,
	labels,
}: AvatarUploadDialogProps) {
	const [imageSrc, setImageSrc] = React.useState<string | null>(null);
	const [crop, setCrop] = React.useState({ x: 0, y: 0 });
	const [zoom, setZoom] = React.useState(1);
	const [croppedAreaPixels, setCroppedAreaPixels] = React.useState<Area | null>(
		null,
	);
	const [isSaving, setIsSaving] = React.useState(false);
	const [isRemoving, setIsRemoving] = React.useState(false);

	const fileInputRef = React.useRef<HTMLInputElement>(null);

	const resetState = React.useCallback(() => {
		if (imageSrc) URL.revokeObjectURL(imageSrc);
		setImageSrc(null);
		setCrop({ x: 0, y: 0 });
		setZoom(1);
		setCroppedAreaPixels(null);
		setIsSaving(false);
		setIsRemoving(false);
		if (fileInputRef.current) fileInputRef.current.value = "";
	}, [imageSrc]);

	// Reset when dialog closes
	React.useEffect(() => {
		if (!open) resetState();
	}, [open, resetState]);

	const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;
		if (!ACCEPTED_TYPES.has(file.type)) {
			toast.error(labels.errorInvalidType);
			event.target.value = "";
			return;
		}
		if (file.size > MAX_BYTES) {
			toast.error(labels.errorTooLarge);
			event.target.value = "";
			return;
		}
		const url = URL.createObjectURL(file);
		setImageSrc(url);
	};

	const handleSave = async () => {
		if (!imageSrc || !croppedAreaPixels) return;
		setIsSaving(true);
		try {
			const blob = await cropImageToBlob(imageSrc, croppedAreaPixels);
			const file = new File([blob], "avatar.jpg", { type: "image/jpeg" });
			await onUpload(file);
			onOpenChange(false);
		} catch (err) {
			toast.error(labels.errorGeneric);
			console.error(err);
		} finally {
			setIsSaving(false);
		}
	};

	const handleRemove = async () => {
		if (!onRemove) return;
		setIsRemoving(true);
		try {
			await onRemove();
			onOpenChange(false);
		} catch (err) {
			toast.error(labels.errorGeneric);
			console.error(err);
		} finally {
			setIsRemoving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{labels.title}</DialogTitle>
					<DialogDescription>{labels.description}</DialogDescription>
				</DialogHeader>

				{imageSrc ? (
					<div className="flex flex-col gap-3">
						<div className="relative h-64 w-full overflow-hidden rounded-md bg-muted">
							<Cropper
								image={imageSrc}
								crop={crop}
								zoom={zoom}
								aspect={1}
								cropShape="round"
								showGrid={false}
								onCropChange={setCrop}
								onZoomChange={setZoom}
								onCropComplete={(_, area) => setCroppedAreaPixels(area)}
							/>
						</div>
						<p className="text-xs text-muted-foreground">{labels.cropHelp}</p>
						<div className="flex items-center gap-3">
							<span className="text-xs text-muted-foreground">1×</span>
							<Slider
								value={[zoom]}
								min={1}
								max={3}
								step={0.05}
								onValueChange={(v) => setZoom(v[0] ?? 1)}
							/>
							<span className="text-xs text-muted-foreground">3×</span>
						</div>
					</div>
				) : (
					<div className="flex flex-col items-center gap-4 py-4">
						<UserAvatar
							name={name}
							image={currentImage}
							className="size-32 text-3xl"
						/>
						<input
							ref={fileInputRef}
							type="file"
							accept="image/png,image/jpeg,image/webp"
							onChange={handleFileChange}
							className="hidden"
						/>
						<Button type="button" onClick={() => fileInputRef.current?.click()}>
							{labels.chooseFile}
						</Button>
					</div>
				)}

				<DialogFooter className="flex-row justify-between sm:justify-between">
					{imageSrc ? (
						<>
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									URL.revokeObjectURL(imageSrc);
									setImageSrc(null);
								}}
								disabled={isSaving}
							>
								{labels.back}
							</Button>
							<Button type="button" onClick={handleSave} disabled={isSaving}>
								{isSaving ? "..." : labels.save}
							</Button>
						</>
					) : (
						<>
							{currentImage && onRemove ? (
								<Button
									type="button"
									variant="destructive"
									onClick={handleRemove}
									disabled={isRemoving}
								>
									{isRemoving ? "..." : labels.remove}
								</Button>
							) : (
								<span />
							)}
							<Button
								type="button"
								variant="ghost"
								onClick={() => onOpenChange(false)}
							>
								{labels.cancel}
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
