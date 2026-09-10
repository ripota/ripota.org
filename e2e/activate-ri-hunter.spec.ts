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
    await expect(page.getByText("No checklist has been saved")).toBeVisible();

    await page.getByLabel("Choose CSV file").setInputFiles({ name: "hunter_parks.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.locator("[data-hunter-status]")).toContainText("Import complete");
    await expect(page.getByRole("heading", { name: /1 of 61 Rhode Island parks hunted/ })).toBeVisible();
    await expect(page.getByText(/There is 1 remaining park with an announced activation window/)).toBeVisible();
    await expect(page.locator("[data-hunter-import-panel]")).not.toHaveAttribute("open", "");
    await expect(page.locator("[data-hunter-saved-note]")).toContainText("Saved in this browser.");
    await expect(page.locator("[data-hunter-progress-text]")).toBeFocused();
    const huntedPark = page.locator("[data-hunter-complete] li").filter({ hasText: "US-0513" });
    await expect(huntedPark.getByRole("link", { name: "Open local field guide" })).toHaveAttribute("href", "/parks/us-0513/");
    expect(await page.locator("[data-hunter-results]").evaluate((results) => {
      const importPanel = document.querySelector("[data-hunter-import-panel]");
      return Boolean(importPanel && results.compareDocumentPosition(importPanel) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);

    await page.getByRole("link", { name: "View and print my schedule" }).click();
    await expect(page).toHaveURL(/\/activate-ri-2026\/schedule\/\?scope=remaining/);
    await expect(page.getByRole("heading", { name: "Schedule for your remaining parks" })).toBeVisible();
    await expect(page.getByText("1 activation window covering 1 of your 60 remaining parks matches the current filters.")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "US-0514" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "US-0514" }).getByRole("link", { name: "John H. Chafee National Wildlife Refuge" })).toHaveAttribute("href", "/parks/us-0514/");
    await expect(page.getByRole("row").filter({ hasText: "US-0513" })).toBeHidden();
    await page.locator("[data-timezone]").selectOption("utc");
    await page.locator('[data-filter="mode"]').selectOption("SSB");
    await expect(page.locator("[data-schedule-count]")).toHaveText("0 matching activation windows.");
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(page.locator("[data-hunter-scope]")).toHaveValue("all");
    await expect(page.locator("[data-timezone]")).toHaveValue("utc");
    await expect(page.locator("[data-schedule-count]")).toHaveText("2 matching activation windows.");
    await expect(page).toHaveURL(/\?timezone=utc$/);
    await page.getByRole("button", { name: "Reload schedule", exact: true }).click();
    await expect(page.locator("[data-timezone]")).toHaveValue("utc");
    await expect(page.locator("[data-schedule-loaded]")).toContainText("Reload to check for changes.");
    await page.locator("[data-hunter-scope]").selectOption("remaining");
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
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => {
      const table = document.querySelector("[data-live-schedule]");
      return {
        cell: getComputedStyle(table?.querySelector("td") as Element).display,
        row: getComputedStyle(table?.querySelector("[data-filter-row]:not([hidden])") as Element).display,
        tbody: getComputedStyle(table?.querySelector("tbody") as Element).display,
        thead: getComputedStyle(table?.querySelector("thead") as Element).display,
      };
    })).toEqual({
      cell: "table-cell",
      row: "table-row",
      tbody: "table-row-group",
      thead: "table-header-group",
    });
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await page.getByRole("link", { name: "Hunter", exact: true }).click();

    await page.getByLabel(/US-0514 .* hunted/).check();
    await expect(page.getByRole("heading", { name: /2 of 61 Rhode Island parks hunted/ })).toBeVisible();
    await expect(page.getByLabel(/US-0514 .* hunted/)).toBeFocused();
    await page.getByLabel("Show").selectOption("hunted");
    await page.getByLabel("Search parks").fill("US-0514");
    await expect(page.getByText("US-0514", { exact: true })).toBeVisible();
    await expect(page.locator("[data-hunter-filter-status]")).toContainText("Showing 1 hunted park matching “US-0514”");
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(page.getByLabel("Show")).toHaveValue("all");
    await expect(page.getByLabel("Search parks")).toBeFocused();

    await page.reload();
    await expect(page.getByRole("heading", { name: /2 of 61 Rhode Island parks hunted/ })).toBeVisible();
    await expect(page.locator("[data-hunter-status]")).toHaveText("Your saved checklist is ready.");
    await expect(page.locator("[data-hunter-import-panel]")).not.toHaveAttribute("open", "");
    await page.getByRole("link", { name: "View schedule for US-0514", exact: true }).click();
    await expect(page).toHaveURL(/\/schedule\/\?q=US-0514$/);
    await expect(page.locator("[data-schedule-search]")).toHaveValue("US-0514");
    await expect(page.locator("[data-filter-row]:visible")).toHaveCount(1);
    await expect(page.locator("[data-filter-row]:visible")).toContainText("US-0514");
    await page.goBack();
    await expect(page.getByRole("heading", { name: /2 of 61 Rhode Island parks hunted/ })).toBeVisible();
    await expect(page.getByLabel(/US-0514 .* hunted/)).toBeChecked();
    await page.locator("[data-hunter-update-import]").click();
    await expect(page.locator("[data-hunter-import-panel]")).toHaveAttribute("open", "");
    await page.getByLabel("Choose CSV file").setInputFiles({ name: "hunter_parks.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByRole("heading", { name: /2 of 61 Rhode Island parks hunted/ })).toBeVisible();
    await page.getByRole("button", { name: "Reset manual changes" }).click();
    await expect(page.getByRole("heading", { name: /1 of 61 Rhode Island parks hunted/ })).toBeVisible();
    await page.getByRole("button", { name: "Clear my checklist data" }).click();
    await expect(page.getByText("Checklist data cleared")).toBeVisible();
  } finally {
    await server.stop();
  }
});

test("a blank checklist persists without a fake import and resets back to all parks remaining", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.goto(`${server.origin}/activate-ri-2026/hunter/`);
    await page.getByRole("button", { name: "Start a blank checklist", exact: true }).click();
    await expect(page.getByRole("heading", { name: /0 of 61 Rhode Island parks hunted/ })).toBeVisible();
    await expect(page.locator("[data-hunter-saved-note]")).toContainText("Started without a CSV import.");
    await expect(page.locator("[data-hunter-blank-start]")).toBeHidden();
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem("activate-ri-2026:hunter-checklist:v1")!));
    expect(state.lastImportedAt).toBeNull();
    expect(state.startedAt).toEqual(expect.any(String));
    await page.reload();
    await expect(page.getByRole("heading", { name: /0 of 61 Rhode Island parks hunted/ })).toBeVisible();
    await page.getByLabel(/US-0513 .* hunted/).check();
    await expect(page.getByRole("heading", { name: /1 of 61 Rhode Island parks hunted/ })).toBeVisible();
    await page.getByRole("button", { name: "Reset manual changes", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("heading", { name: /0 of 61 Rhode Island parks hunted/ })).toBeVisible();
    await expect(page.locator("[data-hunter-blank-start]")).toBeHidden();
    await page.getByRole("button", { name: "Clear my checklist data", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start a blank checklist", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start a blank checklist", exact: true })).toBeFocused();
  } finally {
    await server.stop();
  }
});

test("hunter search and status links restore across import, reload, history, and a fresh browser", async ({ page, browser }) => {
  const server = await startActivateRiServer();
  try {
    await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops: [] } }));
    await page.goto(`${server.origin}/activate-ri-2026/hunter/?status=hunted&q=US-0513&source=club&source=email#hunter-requested-parks`);
    const root = page.locator("[data-hunter-checklist]");
    const search = root.locator("[data-hunter-search]");
    const filter = root.locator("[data-hunter-filter]");
    const remaining = root.locator("[data-hunter-remaining-section]");
    const completed = root.locator("[data-hunter-complete-section]");
    await expect(search).toHaveValue("US-0513");
    await expect(filter).toHaveValue("hunted");
    await page.getByLabel("Choose CSV file").setInputFiles({ name: "hunter_parks.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(completed.locator("li")).toHaveCount(1);
    await expect(completed).toBeVisible();
    await expect(remaining).toBeHidden();
    await expect(completed).toContainText("US-0513");

    await filter.selectOption("remaining");
    await expect(remaining).toBeVisible();
    await expect(remaining.locator("li")).toHaveCount(0);
    await search.fill("US-051");
    await search.fill("US-0514");
    await expect(remaining.locator("li")).toHaveCount(1);
    await expect(remaining).toContainText("US-0514");
    const sharedUrl = page.url();
    expect(Object.fromEntries(new URL(sharedUrl).searchParams)).toMatchObject({ status: "remaining", q: "US-0514" });
    expect(new URL(sharedUrl).searchParams.getAll("source")).toEqual(["club", "email"]);
    expect(new URL(sharedUrl).hash).toBe("#hunter-requested-parks");

    await page.goBack();
    await expect(search).toHaveValue("US-0513");
    await expect(filter).toHaveValue("remaining");
    await expect(remaining.locator("li")).toHaveCount(0);
    await page.goBack();
    await expect(filter).toHaveValue("hunted");
    await expect(completed).toBeVisible();
    await expect(completed.locator("li")).toHaveCount(1);
    await page.goForward();
    await page.goForward();
    await expect(page).toHaveURL(sharedUrl);
    await page.reload();
    await expect(search).toHaveValue("US-0514");
    await expect(filter).toHaveValue("remaining");
    await expect(remaining.locator("li")).toHaveCount(1);

    const fresh = await browser.newContext();
    try {
      const recipient = await fresh.newPage();
      await recipient.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops: [] } }));
      await recipient.goto(sharedUrl);
      await expect(recipient.locator("[data-hunter-results]")).toBeHidden();
      await recipient.getByRole("button", { name: "Start a blank checklist", exact: true }).click();
      await expect(recipient.locator("[data-hunter-search]")).toHaveValue("US-0514");
      await expect(recipient.locator("[data-hunter-filter]")).toHaveValue("remaining");
      await expect(recipient.locator("[data-hunter-remaining] li")).toHaveCount(1);
      await expect(recipient.locator("[data-hunter-progress-text]")).toContainText("0 of 61");
    } finally {
      await fresh.close();
    }

    await root.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("");
    await expect(filter).toHaveValue("all");
    await expect(remaining.locator("li")).toHaveCount(60);
    await expect(completed.locator("li")).toHaveCount(1);
    await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/hunter/?source=club&source=email#hunter-requested-parks`);
    await page.goBack();
    await expect(page).toHaveURL(sharedUrl);
    await expect(filter).toHaveValue("remaining");
    await expect(search).toHaveValue("US-0514");
    await root.getByRole("button", { name: "Clear my checklist data", exact: true }).click();
    await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/hunter/?source=club&source=email#hunter-requested-parks`);
    await expect(root.locator("[data-hunter-results]")).toBeHidden();

    await page.goto(`${server.origin}/activate-ri-2026/hunter/?status=unknown&q=%20%20&source=club#hunter-requested-parks`);
    await expect(filter).toHaveValue("all");
    await expect(search).toHaveValue("");
    await expect(page).toHaveURL(`${server.origin}/activate-ri-2026/hunter/?source=club#hunter-requested-parks`);
  } finally {
    await server.stop();
  }
});

test("pasted requested references validate without changing an existing checklist", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.goto(`${server.origin}/activate-ri-2026/hunter/#hunter-requested-parks`);
    const savedState = JSON.stringify({
      version: 1, importedReferenceIds: ["US-0513"], manualOverrides: {}, lastImportedAt: "2026-09-01T12:00:00.000Z",
    });
    // Another tab may have saved a checklist after this page first loaded.
    await page.evaluate((saved) => localStorage.setItem("activate-ri-2026:hunter-checklist:v1", saved), savedState);
    await page.getByRole("button", { name: "Start a blank checklist", exact: true }).click();
    await expect(page.getByRole("heading", { name: /1 of 61 Rhode Island parks hunted/ })).toBeVisible();
    await expect(page.locator("[data-hunter-blank-start]")).toBeHidden();
    const input = page.locator("[data-hunter-requested-input]");
    await expect(page.locator("[data-hunter-requested-parks]")).toHaveAttribute("open", "");
    await input.fill("US-0514 BAD US-9999");
    await page.getByRole("button", { name: "View requested parks schedule", exact: true }).click();
    await expect(page.locator("[data-hunter-requested-error]")).toContainText("BAD");
    await expect(page.locator("[data-hunter-requested-error]")).toContainText("US-9999");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/hunter\/#hunter-requested-parks$/);
    await input.fill(" ; , ");
    await page.getByRole("button", { name: "View requested parks schedule", exact: true }).click();
    await expect(page.locator("[data-hunter-requested-error]")).toContainText("Enter at least one");
    await input.fill("us-0514; US-0513\nUS-0514");
    await page.getByRole("button", { name: "View requested parks schedule", exact: true }).click();
    await expect(page).toHaveURL(/\/schedule\/\?parks=US-0513%2CUS-0514$/);
    expect(await page.evaluate(() => localStorage.getItem("activate-ri-2026:hunter-checklist:v1"))).toBe(savedState);
    await page.goBack();
    await expect(page.getByRole("heading", { name: /1 of 61 Rhode Island parks hunted/ })).toBeVisible();
    await expect(page.getByLabel(/US-0513 .* hunted/)).toBeChecked();
  } finally {
    await server.stop();
  }
});

test("an unsaved checklist can still open a schedule containing its remaining parks", async ({ page }) => {
  const server = await startActivateRiServer();
  try {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => { throw new DOMException("Storage is unavailable", "QuotaExceededError"); };
    });
    await page.route("**/api/activate-ri-2026/public/stops", route => route.fulfill({ json: { ok: true, stops: [] } }));
    await page.goto(`${server.origin}/activate-ri-2026/hunter/`);
    await page.getByRole("button", { name: "Start a blank checklist", exact: true }).click();
    await page.getByLabel(/US-0513 .* hunted/).check();
    await expect(page.locator("[data-hunter-error]")).toContainText("cannot be saved");
    const schedule = page.getByRole("link", { name: "View and print my schedule", exact: true });
    const agenda = new URL((await schedule.getAttribute("href"))!, server.origin);
    expect(agenda.searchParams.get("scope")).toBeNull();
    const requested = agenda.searchParams.get("parks")!.split(",");
    expect(requested).toHaveLength(60);
    expect(requested).not.toContain("US-0513");
    await schedule.click();
    await expect(page.locator("[data-requested-schedule-references]")).toContainText("US-0514");
    await expect(page.locator("[data-requested-schedule-references]")).not.toContainText("US-0513");
    await expect(page.locator("[data-personal-schedule-import]")).toBeHidden();
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
    await expect(page.locator("[data-hunter-status]")).toContainText("Import complete");
    await expect(page.getByRole("heading", { name: /0 of 61 Rhode Island parks hunted/ })).toBeVisible();

    await page.locator("[data-hunter-update-import]").click();
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
    await expect(page.locator("[data-hunter-status]")).toContainText("Import complete with warnings");
    await expect(page.locator("[data-hunter-status]")).toContainText("Recovered 1 malformed row");
    await expect(page.locator("[data-hunter-status]")).toContainText("Skipped 1 unreadable row");
    await expect(page.locator("[data-hunter-status]")).toContainText("may be incomplete");
    await expect(page.getByRole("heading", { name: /1 of 61 Rhode Island parks hunted/ })).toBeVisible();

    await page.locator("[data-hunter-update-import]").click();
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
