import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLocation } from "react-router";
import {
	expect,
	screen,
	spyOn,
	userEvent,
	waitFor,
	within,
} from "storybook/test";
import { reactRouterParameters } from "storybook-addon-remix-react-router";
import { API } from "#/api/api";
import { organizationsPermissions } from "#/api/queries/organizations";
import {
	MockDefaultOrganization,
	MockOrganization2,
	MockOrganizationPermissions,
} from "#/testHelpers/entities";
import { withDashboardProvider } from "#/testHelpers/storybook";
import OrganizationModelsLayout from "./OrganizationModelsLayout";

// Surfaces the active route's pathname so the play function can assert
// where the autocomplete's navigation landed.
const PathnameProbe = () => {
	const location = useLocation();
	return <div data-testid="pathname-probe">{location.pathname}</div>;
};

const meta: Meta<typeof OrganizationModelsLayout> = {
	title: "pages/AISettingsPage/OrganizationModelsLayout",
	component: OrganizationModelsLayout,
	decorators: [withDashboardProvider],
	parameters: {
		showOrganizations: true,
		organizations: [MockDefaultOrganization, MockOrganization2],
		reactRouter: reactRouterParameters({
			location: {
				path: `/ai/settings/organizations/${MockDefaultOrganization.name}/models`,
			},
			routing: [
				{
					path: "/ai/settings/organizations/:organization/models",
					useStoryElement: true,
				},
			],
		}),
		queries: [
			{
				key: organizationsPermissions([
					MockDefaultOrganization.id,
					MockOrganization2.id,
				]).queryKey,
				data: {
					[MockDefaultOrganization.id]: MockOrganizationPermissions,
					[MockOrganization2.id]: MockOrganizationPermissions,
				},
			},
		],
	},
};

export default meta;
type Story = StoryObj<typeof OrganizationModelsLayout>;

export const SwitchOrganizationNavigates: Story = {
	render: () => (
		<>
			<OrganizationModelsLayout />
			<PathnameProbe />
		</>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", {
				name: new RegExp(
					`Organization: ${MockDefaultOrganization.display_name}`,
					"i",
				),
			}),
		);
		// The active organization sorts first, then case-insensitive
		// alphabetical; MockOrganization2 is the other entry.
		const option = await screen.findByRole("option", {
			name: new RegExp(MockOrganization2.display_name),
		});
		await userEvent.click(option);
		await waitFor(() => {
			expect(screen.getByTestId("pathname-probe")).toHaveTextContent(
				`/ai/settings/organizations/${MockOrganization2.name}/models`,
			);
		});
	},
};

export const Loading: Story = {
	beforeEach: () => {
		spyOn(API, "checkAuthorization").mockImplementation(
			() => new Promise(() => undefined),
		);
	},
	parameters: { queries: [] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expect(await canvas.findByRole("status")).toBeVisible();
	},
};

export const ErrorState: Story = {
	beforeEach: () => {
		spyOn(API, "checkAuthorization").mockRejectedValue(
			new Error("Failed to load organization permissions"),
		);
	},
	parameters: { queries: [] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expect(
			await canvas.findByText("Failed to load organization permissions"),
		).toBeVisible();
	},
};

export const NoManageableOrganizations: Story = {
	parameters: {
		queries: [
			{
				key: organizationsPermissions([
					MockDefaultOrganization.id,
					MockOrganization2.id,
				]).queryKey,
				data: {
					[MockDefaultOrganization.id]: {
						...MockOrganizationPermissions,
						createChatModelConfigs: false,
						editChatModelConfigs: false,
					},
					[MockOrganization2.id]: {
						...MockOrganizationPermissions,
						createChatModelConfigs: false,
						editChatModelConfigs: false,
					},
				},
			},
		],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expect(
			await canvas.findByText("No manageable organizations"),
		).toBeVisible();
	},
};

export const OrganizationUnavailable: Story = {
	parameters: {
		reactRouter: reactRouterParameters({
			location: {
				path: "/ai/settings/organizations/unknown/models",
			},
			routing: [
				{
					path: "/ai/settings/organizations/:organization/models",
					useStoryElement: true,
				},
			],
		}),
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expect(await canvas.findByText("Organization unavailable")).toBeVisible();
	},
};
