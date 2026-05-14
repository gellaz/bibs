import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, ms: number): T {
	const [out, setOut] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setOut(value), ms);
		return () => clearTimeout(t);
	}, [value, ms]);
	return out;
}
