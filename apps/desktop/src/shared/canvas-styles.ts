import { formatOklch } from "@praxity/shared-blocks/color-math";
import { defaultDarkTheme } from "../renderer/themes/default-dark";
import { defaultLightTheme } from "../renderer/themes/default-light";

/** Values come from Studio's contrast-corrected themes, never authored custom properties. */
export const canvasStyles = Object.fromEntries(
	[defaultLightTheme, defaultDarkTheme].map((theme) => {
		const tokens = Object.entries(theme.colors)
			.map(
				([name, value]) =>
					`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${formatOklch(value)}`,
			)
			.join(";");
		return [
			theme.appearance,
			`
:host::backdrop{display:none!important}
.studio{${tokens};all:initial;display:block;box-sizing:border-box;font:14px/1.5 system-ui,sans-serif;color:var(--text-primary);color-scheme:${theme.appearance};text-align:start;direction:ltr}
*{box-sizing:border-box} [hidden]{display:none!important}
nav.studio{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 12px;align-items:start;width:100%;padding:8px 12px;background:var(--bg-panel);border:1px solid var(--control-border);border-radius:8px}
nav.studio>a,nav.studio>.read-size{grid-column:2;grid-row:1;justify-self:start}
.read-size{visibility:hidden;pointer-events:none}.status-slot{grid-column:1/-1;min-height:1.5em;overflow-wrap:anywhere}
.announcement-only{position:absolute;width:1px;height:1px;min-height:0!important;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
button,a,textarea,.read-size{font:inherit;color:var(--text-primary)}
button,a,.read-size{scroll-margin-block:6px;min-height:32px;min-width:32px;padding:4px 10px;border:1px solid var(--control-border);border-radius:5px;background:var(--control-bg)}
a,.read-size{display:inline-flex;align-items:center;color:var(--accent-on-surface);text-decoration:underline}
button{cursor:pointer}button:disabled{color:var(--text-secondary);cursor:default}
button[aria-pressed]{border-width:2px;font-weight:600}button[aria-pressed="true"]{text-decoration:underline;text-underline-offset:3px}
.edit{background:var(--bg-panel);font-size:13px;padding:2px 8px}
.caption-context{display:inline-block;max-inline-size:min(24ch,calc(100% - 88px));overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;margin-inline-start:8px;font-size:13px;overflow-wrap:anywhere}.caption-context:empty,.field:not([hidden])+.caption-context{display:none}
@media(min-width:768px){nav.studio{grid-template-columns:max-content max-content minmax(0,1fr);align-items:start}nav.studio>.status-slot{grid-column:3;grid-row:1}}
button:focus-visible,a:focus-visible,textarea:focus{outline:3px solid var(--focus-ring);outline-offset:2px}
.field{width:100%;padding:12px;border:1px solid var(--control-border);border-radius:8px;background:var(--bg-panel)}
label{display:block;font-weight:600}p{margin:6px 0;overflow-wrap:anywhere}
#hint{color:var(--text-secondary)}
textarea{display:block;width:100%;min-height:72px;field-sizing:content;padding:8px;resize:vertical;background:var(--control-bg);border:1px solid var(--control-border);border-radius:4px}
textarea:read-only{cursor:progress}
#error{color:var(--status-error)}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
@media(forced-colors:active){button,a,textarea{border-color:ButtonText}button:focus-visible,a:focus-visible,textarea:focus{outline-color:Highlight}}
`,
		];
	}),
) as Record<"light" | "dark", string>;
