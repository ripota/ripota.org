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
    await page.route("**/api/activate-ri-2026/public/stops", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          stops: [{
            id: "hunter-schedule-stop",
            parkReference: "US-0513",
            plannedDate: "2026-09-12",
            startTime: "13:00",
            endTime: "15:00",
            activatorCallsign: "W1AW",
            bands: ["20m"],
            modes: ["SSB"],
            publicNotes: "",
            status: "scheduled",
          }, {
            id: "hunter-remaining-schedule-stop",
            parkReference: "US-0514",
            plannedDate: "2026-09-13",
            startTime: "15:00",
            endTime: "18:00",
            activatorCallsign: "N1RI",
            bands: ["40m"],
            modes: ["CW"],
            publicNotes: "",
            status: "scheduled",
          }],
        }),
      });
    });
    await page.goto(`${server.origin}/activate-ri-2026/hunter/`);
    await expect(page.getByRole("link", { name: "Hunter", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: /Open POTA My Stats/ })).toHaveAttribute("href", "https://pota.app/#/user/stats");
    await expect(page.getByText("No checklist has been imported")).toBeVisible();

    await page.getByLabel("Choose CSV file").setInputFiles({ name: "hunter_parks.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByRole("status")).toContainText("Import complete");
    await expect(page.getByRole("heading", { name: /1 of 61 Rhode Island parks hunted/ })).toBeVisible();
    await expect(page.getByText(/There is 1 remaining park with an announced activation window/)).toBeVisible();

    await page.getByRole("link", { name: "View and print my schedule" }).click();
    await expect(page).toHaveURL(/\/activate-ri-2026\/schedule\/\?scope=remaining/);
    await expect(page.getByRole("heading", { name: "Schedule for your remaining parks" })).toBeVisible();
    await expect(page.getByText(/1 activation window covering 1 of your 60 remaining parks/)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "US-0514" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "US-0513" })).toBeHidden();
    await page.evaluate(() => {
      window.print = () => {
        window.dispatchEvent(new Event("beforeprint"));
        document.body.setAttribute("data-print-called", "true");
      };
    });
    await page.getByRole("button", { name: "Print filtered schedule" }).click();
    await expect(page.locator("body")).toHaveAttribute("data-print-called", "true");
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("[data-schedule-print-heading]")).toBeVisible();
    await expect(page.getByRole("form", { name: "Schedule filters" })).toBeHidden();
    await expect(page.getByRole("row").filter({ hasText: "US-0514" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "US-0513" })).toBeHidden();
    await expect(page.getByText(/US-0515 Ninigret National Wildlife Refuge/)).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await page.goBack();

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
      buffer: Buffer.from([
        '"DX Entity","Location","HASC","Reference","Park Name","First QSO Date","QSOs"',
        '"United States","US-UT","US.UT","US-13488","Pando - "I Spread" - Aspen Clone Site","2026-01-01",1',
        '"Unreadable row',
        '"United States","US-RI","US.RI","US-0513","Synthetic Island","2026-01-02",2',
      ].join("\n")),
    });
    await expect(page.getByRole("status")).toContainText("Import complete with warnings");
    await expect(page.getByRole("status")).toContainText("Recovered 1 malformed row");
    await expect(page.getByRole("status")).toContainText("Skipped 1 unreadable row");
    await expect(page.getByRole("status")).toContainText("may be incomplete");
    await expect(page.getByRole("heading", { name: /1 of 61 Rhode Island parks hunted/ })).toBeVisible();

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
