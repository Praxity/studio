import { useLocale } from "../i18n/locale-context";
import { useStrings } from "../i18n/use-strings";

export function RequiredIndicator() {
	const s = useStrings(useLocale());

	return (
		<span className="praxity-required-indicator">
			<span aria-hidden="true" className="praxity-required-marker" />
			<span className="praxity-sr-only">{s.required}</span>
		</span>
	);
}
