import type { Accent } from '@super-review/core/types';

export interface AccentOption {
	id: Accent;
	label: string;
	// Background + text for the default-button preview in the picker.
	primary: string;
	fg: string;
}

export const ACCENTS: AccentOption[] = [
	{
		id: 'super',
		label: 'Super',
		primary: 'linear-gradient(135deg, hsl(16 100% 70%), hsl(6 88% 56%))',
		fg: 'hsl(20 14% 9%)'
	},
	{
		id: 'mono',
		label: 'Monochrome',
		primary: 'var(--color-foreground)',
		fg: 'var(--color-background)'
	}
];
