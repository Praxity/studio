export interface CustomThemeOverrides {
	defaultImageTreatment?: string;
	cornerStyle?: "sharp" | "subtle" | "soft" | "round";
	colorBackground?: string;
	colorText?: string;
	colorAccent?: string;
	colorButtonBackground?: string;
	fontFamilyBody?: string;
	borderRadius?: number;
	[key: string]: unknown;
}
