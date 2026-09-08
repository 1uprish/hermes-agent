/**
 * Onboarding brand constants — the landing page's blue and the self-hosted
 * display faces (shared with the intro cinematic). Everything generic lives
 * in `components/wizard-shell`.
 */

export const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

/** The landing page's Hermes blue — `--hw-bg` in nousnet-web/theme.css. */
export const HERMES_BLUE = '#0000f2'

/** Brand faces from public/intro-fonts — display type only; body text keeps
 *  the app's stack. */
export const FONT_CSS = `
@font-face {
  font-family: 'Sigurd';
  src: url('${assetPath('intro-fonts/Sigurd-Variable.woff2')}') format('woff2');
  font-weight: 100 900;
  font-display: block;
}
@font-face {
  font-family: 'Courier Prime';
  src: url('${assetPath('intro-fonts/CourierPrime-Regular.woff2')}') format('woff2');
  font-weight: 400;
  font-display: block;
}
`
