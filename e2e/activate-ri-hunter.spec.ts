import { expect, test } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

const csv = [
  '"DX Entity","Location","HASC","Reference","Park Name","First QSO Date","QSOs"',
  '"United States","US-RI","US.RI","US-0513","Synthetic, Island","20260101","1"',
  '"United States","US-MA","US.MA","US-9999","Synthetic Elsewhere","20260102","2"',
].join("\r\n");

test("hunter imports, overrides, filters, persists, resets, and clears a local checklist", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.goto(`${server.origin}/activate-ri-2026/hunter/`);
    await expect(page.getByRole("link", { name: "Hunter", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: /Open POTA My Stats/ })).toHaveAttribute("href", "https://pota.app/#/user/stats");
    await expect(page.getByText("No checklist has been imported")).toBeVisible();

    await page.getByLabel("Choose CSV file").setInputFiles({ name: "hunter_parks.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByRole("status")).toContainText("Import complete");
    await expect(page.getByRole("heading", { name: /1 of 61 Rhode Island parks hunted/ })).toBeVisible();

    await page.getByLabel(/US-0514 .* hunted/).check();
    await expect(page.getByRole("heading", { name: /2 of 61 Rhode Island parks hunted/ })).toBeVisible();
    await page.getByLabel("Show").selectOption("hunted");
    await page.getByLabel("Search parks").fill("US-0514");
    await expect(page.getByText("US-0514", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: /2 of 61 Rhode Island parks hunted/ })).toBeVisible();
    await page.getByRole("button", { name: "Reset manual changes" }).click();
    await expect(page.getByRole("heading", { name: /1 of 61 Rhode Island parks hunted/ })).toBeVisible();
    await page.getByRole("button", { name: "Clear my checklist data" }).click();
    await expect(page.getByText("Checklist data cleared")).toBeVisible();
  } finally {
    await server.stop();
  }
});

test("hunter accepts a dropped zero-match export and reports invalid input", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.goto(`${server.origin}/activate-ri-2026/hunter/`);
    await page.locator("[data-hunter-drop]").evaluate((target, contents) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([contents], "hunter_parks.csv", { type: "text/csv" }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, csv.replace("US-0513", "US-9998"));
    await expect(page.getByRole("status")).toContainText("Import complete");
    await expect(page.getByRole("heading", { name: /0 of 61 Rhode Island parks hunted/ })).toBeVisible();

    await page.getByLabel("Choose CSV file").setInputFiles({
      name: "hunter_parks.csv",
      mimeType: "text/csv",
      buffer: Buffer.from('"Park Name"\n"No Reference"'),
    });
    await expect(page.getByRole("alert")).toContainText("Reference");
  } finally {
    await server.stop();
  }
});
