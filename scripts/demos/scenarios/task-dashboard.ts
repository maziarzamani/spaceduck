import type { DemoScenario } from "../types";

const scenario: DemoScenario = {
  name: "task-dashboard",
  description: "Open the task dashboard, view spend cards, and create dialog",

  async run(page, baseUrl) {
    await page.goto(baseUrl);

    // Wait for chat view to load
    const textarea = page.locator('textarea[placeholder="Type a message..."]');
    await textarea.waitFor({ state: "visible", timeout: 10_000 });
    await page.waitForTimeout(500);

    // Click the Tasks button in the sidebar (tooltip text: "Tasks")
    const tasksBtn = page.locator('button').filter({ has: page.locator('svg.lucide-list-todo') });
    // Fallback: try finding by tooltip content
    const tasksButton = tasksBtn.first().or(
      page.getByRole("button", { name: "Tasks" }).first()
    );
    await tasksButton.click();

    // Wait for the Tasks view header
    const header = page.locator("h1", { hasText: "Tasks" });
    await header.waitFor({ state: "visible", timeout: 5_000 });
    await page.waitForTimeout(800);

    // Assert: spend card with "Today" label is visible
    const todayLabel = page.locator("text=Today").first();
    await todayLabel.waitFor({ state: "visible", timeout: 5_000 });

    // Click "New task" button
    const newTaskBtn = page.getByRole("button", { name: /new task/i });
    await newTaskBtn.click();
    await page.waitForTimeout(600);

    // Assert: create dialog opened — look for the tab labels or dialog content
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ state: "visible", timeout: 3_000 });

    // Let the GIF capture the dialog
    await page.waitForTimeout(1500);

    // Close dialog with Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  },
};

export default scenario;
