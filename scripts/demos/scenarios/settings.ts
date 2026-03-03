import type { DemoScenario } from "../types";

const scenario: DemoScenario = {
  name: "settings",
  description: "Open settings, view provider config, and navigate back",

  async run(page, baseUrl) {
    await page.goto(baseUrl);

    // Wait for chat view to load
    const textarea = page.locator('textarea[placeholder="Type a message..."]');
    await textarea.waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(500);

    // Click the Settings button in the sidebar (icon: Settings/gear)
    const settingsBtn = page.locator('button').filter({ has: page.locator('svg.lucide-settings') });
    const settingsButton = settingsBtn.first().or(
      page.getByRole("button", { name: "Settings" }).first()
    );
    await settingsButton.click();

    // Wait for Settings view to render
    const backBtn = page.getByRole("button", { name: /back to chat/i });
    await backBtn.waitFor({ state: "visible", timeout: 5_000 });
    await page.waitForTimeout(800);

    // Assert: provider-related content visible
    const providerSection = page.locator("text=Chat Model").first().or(
      page.locator("text=Provider").first()
    );
    await providerSection.waitFor({ state: "visible", timeout: 5_000 });

    // Scroll down a bit to show more settings
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(1000);

    // Click back to chat
    await backBtn.click();

    // Assert: chat textarea visible again
    await textarea.waitFor({ state: "visible", timeout: 5_000 });
    await page.waitForTimeout(500);
  },
};

export default scenario;
