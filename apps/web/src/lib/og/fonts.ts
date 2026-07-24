import { GoogleFont, resolveFonts } from '@ethercorps/sveltekit-og/fonts';

const redHatDisplayBold = new GoogleFont('Red Hat Display', { weight: 700 });
const redHatDisplayExtraBold = new GoogleFont('Red Hat Display', { weight: 800 });
const redHatDisplayBlack = new GoogleFont('Red Hat Display', { weight: 900 });
const redHatDisplayMedium = new GoogleFont('Red Hat Display', { weight: 500 });
const geistMono = new GoogleFont('Geist Mono', { weight: 400 });

export async function resolveOgFonts() {
	return resolveFonts([
		redHatDisplayMedium,
		redHatDisplayBold,
		redHatDisplayExtraBold,
		redHatDisplayBlack,
		geistMono
	]);
}
