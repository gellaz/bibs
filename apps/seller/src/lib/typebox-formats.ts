import { FormatRegistry } from "@sinclair/typebox";

/**
 * Register custom TypeBox formats for frontend validation.
 *
 * TypeBox does NOT provide built-in format validators — they must be
 * registered via FormatRegistry before TypeCompiler.Compile() is called.
 * Elysia registers its own formats on the server side, so this file
 * covers the frontend only.
 */

if (!FormatRegistry.Has("uri")) {
	FormatRegistry.Set("uri", (value) => {
		try {
			const url = new URL(value);
			return url.protocol === "http:" || url.protocol === "https:";
		} catch {
			return false;
		}
	});
}
