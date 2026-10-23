import { MantineProvider, type MantineProviderProps } from "@mantine/core";
import { render } from "@testing-library/react";
import { IntlProvider } from "use-intl";
import en from "../messages/en.json";

export function renderWithProviders(
	ui: React.ReactElement,
	mantineProps: Pick<MantineProviderProps, "env" | "withCssVariables"> = {},
) {
	return render(
		<IntlProvider locale="en" messages={en}>
			<MantineProvider {...mantineProps}>{ui}</MantineProvider>
		</IntlProvider>,
	);
}
