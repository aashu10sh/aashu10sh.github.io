declare module 'lightense-images' {
	export default function Lightense(
		elements: string | HTMLElement | NodeListOf<HTMLElement>,
		options?: { time?: number; padding?: number; offset?: number; keyboard?: boolean; cubicBezier?: string; background?: string; zIndex?: number },
	): void;
}
