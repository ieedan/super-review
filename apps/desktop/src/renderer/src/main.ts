import { mount } from 'svelte';
// Bundled, self-hosted fonts (mostly Fontsource latin subsets; Geist Mono is
// the official Vercel build, see below). These back the curated UI/code font
// options in Settings, so picking a font is instant and offline — no Local Font
// Access enumeration. Family names: "Inter", "Geist Sans", "JetBrains Mono",
// "Geist Mono", "IBM Plex Mono".
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/geist-sans/latin-400.css';
import '@fontsource/geist-sans/latin-500.css';
import '@fontsource/geist-sans/latin-600.css';
import '@fontsource/geist-sans/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import '@fontsource/jetbrains-mono/latin-700.css';
// Geist Mono is self-hosted from the official Vercel build, NOT @fontsource:
// @fontsource's Geist Mono has broken ligature metrics (operators overlap the
// preceding glyph). See fonts/geist-mono/geist-mono.css for the full rationale.
import './fonts/geist-mono/geist-mono.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-700.css';
import './app.css';
import App from './App.svelte';

const app = mount(App, {
	target: document.getElementById('app')!
});

export default app;
