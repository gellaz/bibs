import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `ms` of quiet.
 *
 * Typical use: keep a controlled input snappy via local state, debounce that
 * state, and let the debounced value drive URL search params / queries so a
 * keystroke doesn't fire a request per character.
 */
export function useDebouncedValue<T>(value: T, ms: number): T {
	const [out, setOut] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setOut(value), ms);
		return () => clearTimeout(t);
	}, [value, ms]);
	return out;
}
