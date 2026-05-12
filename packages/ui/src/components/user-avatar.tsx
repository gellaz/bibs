"use client";

import type * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/avatar";
import { cn } from "~/lib/utils";

function getInitials(name: string | null | undefined): string {
	if (!name) return "?";
	const parts = name.split(" ").filter(Boolean);
	if (parts.length === 0) return "?";
	return parts
		.map((part) => part[0])
		.join("")
		.toUpperCase()
		.slice(0, 2);
}

type Props = React.ComponentProps<typeof Avatar> & {
	name?: string | null;
	image?: string | null;
};

export function UserAvatar({
	name,
	image,
	size = "default",
	className,
	children,
	...props
}: Props) {
	const initials = getInitials(name);
	return (
		<Avatar size={size} className={className} {...props}>
			<AvatarImage src={image ?? undefined} alt={name ?? ""} />
			<AvatarFallback className={cn("bg-ink-soft font-medium text-cream")}>
				{initials}
			</AvatarFallback>
			{children}
		</Avatar>
	);
}
