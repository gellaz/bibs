// The apps get this from `vite/client`; @bibs/ui has no Vite of its own.
declare module "*?url" {
	const url: string;
	export default url;
}
