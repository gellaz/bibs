"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "~/components/input-group";

const DEBOUNCE_MS = 300;

interface SearchInputProps {
	/** Valore confermato (URL o state): il campo lo segue quando cambia da fuori. */
	value: string;
	/** Chiamata dopo 300 ms di quiete, solo se il testo differisce da `value`. */
	onValueChange: (value: string) => void;
	clearLabel: string;
	placeholder?: string;
	"aria-label"?: string;
	/** Classe dell'`InputGroup` (tipicamente la larghezza). */
	className?: string;
}

/**
 * Campo di ricerca delle liste: icona, «cancella», debounce. Nessuna
 * dipendenza dal router: il chiamante decide dove vive il valore confermato.
 */
export function SearchInput({
	value,
	onValueChange,
	clearLabel,
	placeholder,
	"aria-label": ariaLabel,
	className,
}: SearchInputProps) {
	const [text, setText] = useState(value);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	// Back/forward o un reset da fuori vincono su un tasto ancora in attesa:
	// altrimenti il timer rispingerebbe la ricerca vecchia nell'URL.
	useEffect(() => {
		clearTimeout(timer.current);
		setText(value);
	}, [value]);

	useEffect(() => () => clearTimeout(timer.current), []);

	const change = (next: string) => {
		setText(next);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			if (next !== value) onValueChange(next);
		}, DEBOUNCE_MS);
	};

	const clear = () => {
		setText("");
		clearTimeout(timer.current);
		if (value !== "") onValueChange("");
	};

	return (
		<InputGroup className={className}>
			<InputGroupAddon align="inline-start">
				<SearchIcon />
			</InputGroupAddon>
			<InputGroupInput
				value={text}
				onChange={(e) => change(e.target.value)}
				placeholder={placeholder}
				aria-label={ariaLabel}
			/>
			{text.length > 0 && (
				<InputGroupAddon align="inline-end">
					<InputGroupButton
						size="icon-xs"
						onClick={clear}
						aria-label={clearLabel}
					>
						<XIcon />
					</InputGroupButton>
				</InputGroupAddon>
			)}
		</InputGroup>
	);
}
