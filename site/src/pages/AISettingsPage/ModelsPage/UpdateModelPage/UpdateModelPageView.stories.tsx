import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { MockDefaultOrganization } from "#/testHelpers/entities";
import { withToaster } from "#/testHelpers/storybook";
import { OrganizationModelsContext } from "../organizationModels";
import {
	MockAnthropicProviderState,
	MockOpenAIProviderState,
	mockGPT5,
} from "../testFixtures";
import UpdateModelPageView from "./UpdateModelPageView";

const meta: Meta<typeof UpdateModelPageView> = {
	title: "pages/AISettingsPage/ModelsPage/UpdateModelPageView",
	component: UpdateModelPageView,
	decorators: [
		(Story) => (
			<OrganizationModelsContext.Provider
				value={{
					organization: MockDefaultOrganization,
					organizations: [MockDefaultOrganization],
				}}
			>
				<Story />
			</OrganizationModelsContext.Provider>
		),
		withToaster,
	],
	args: {
		state: "loaded",
		model: mockGPT5,
		providerStates: [MockOpenAIProviderState, MockAnthropicProviderState],
		selectedProviderState: MockOpenAIProviderState,
		onProviderChange: fn(),
		isSaving: false,
		isDeleting: false,
		onUpdateModel: fn(async () => undefined),
		onDeleteModel: fn(async () => undefined),
		onDuplicate: fn(),
		onToggleEnabled: fn(),
	},
};

export default meta;
type Story = StoryObj<typeof UpdateModelPageView>;

export const Default: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("button", { name: /^update model$/i }),
		).toBeVisible();
		await expect(canvas.getByLabelText(/model identifier/i)).toBeEnabled();
	},
};

export const RefetchError: Story = {
	args: { refetchError: new Error("Failed to refresh model") },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expect(canvas.getByText("Failed to refresh model")).toBeVisible();
		expect(canvas.getByLabelText(/model identifier/i)).toBeEnabled();
	},
};

export const LoadError: Story = {
	render: () => (
		<UpdateModelPageView
			state="error"
			error={new Error("Failed to load model")}
		/>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByText("Failed to load model")).toBeVisible();
	},
};
