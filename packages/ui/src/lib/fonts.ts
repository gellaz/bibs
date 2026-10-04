import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";

/** Variable Satoshi on Fontshare's CDN — same URL as the @font-face in `styles/fonts.css`. */
export const SATOSHI_URL =
	"https://cdn.fontshare.com/wf/NWBQYJIM7GCZ5XWD7D26ARB3VDY55ZRT/K63EV2KZIGKLE7RANQ2U42S6SVHU5RJ7/X6XYTKIVDUW7GZTZPZNN4EUM5KH54KHF.woff2";

/**
 * `<head>` links for the brand faces, spread into each app's root route before
 * the app stylesheet. Preloads only what the first paint needs: Geist latin
 * (body text) and Satoshi (headings). Fonts are fetched in CORS mode, hence
 * `crossOrigin` on the preloads too, or the browser downloads them twice.
 */
export const fontLinks = [
	{
		rel: "preconnect",
		href: "https://cdn.fontshare.com",
		crossOrigin: "anonymous",
	},
	{
		rel: "preload",
		href: geistLatin,
		as: "font",
		type: "font/woff2",
		crossOrigin: "anonymous",
	},
	{
		rel: "preload",
		href: SATOSHI_URL,
		as: "font",
		type: "font/woff2",
		crossOrigin: "anonymous",
	},
] as const;
