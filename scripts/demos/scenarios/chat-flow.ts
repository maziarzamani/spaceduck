import type { DemoScenario } from "../types";

const scenario: DemoScenario = {
  name: "chat-flow",
  description: "Send a message and watch the assistant respond",

  async run(page, baseUrl) {
    await page.goto(baseUrl);

    // Wait for chat input to be ready
    const textarea = page.locator('textarea[placeholder="Type a message..."]');
    await textarea.waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(800);

    // Type a message
    await textarea.fill("What is 2 + 2? Answer in one sentence.");
    await page.waitForTimeout(400);
    await textarea.press("Enter");

    // Wait for the assistant response to appear
    // The response renders as markdown in a message bubble — look for any new
    // content that wasn't the user's message
    const response = page.locator('[class*="prose"]').first();
    await response.waitFor({ state: "visible", timeout: 30_000 });

    // Let the streaming finish and give the GIF a moment to show the result
    await page.waitForTimeout(3000);

    // Assert: response has actual text content
    const text = await response.textContent();
    if (!text || text.trim().length < 2) {
      throw new Error("Assistant response is empty");
    }
  },
};

export default scenario;
