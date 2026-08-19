import { expect, type Page, test } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

test("volunteer can submit a plan that can be approved and shown publicly", async ({
  page,
  request,
}) => {
  const server = await startActivateRiServer();
  const callsign = randomCallsign();
  const email = `${callsign.toLowerCase()}@example.com`;

  try {
    await page.goto(`${server.origin}/activate-ri-2026/volunteer/`);

    await page.getByLabel(/Callsign/).first().fill(callsign);
    await page.getByLabel(/Name/).first().fill("Rob Jackson");
    await page.getByLabel(/Email/).first().fill(email);
    await page.getByLabel("Club / group affiliation").fill("RI POTA");
    await page.locator("[data-park-input]").fill("US-2868");
    await page.getByRole("button", { name: "US-2868" }).click();
    await page.locator("[data-planned-date]").selectOption("2026-09-11");
    await page.locator("[data-time-block]").selectOption("09:00-12:00");

    await expect(page.locator("[data-bands] [data-multi-toggle]")).toHaveText("40m, 20m, 15m");
    await expect(page.locator("[data-modes] [data-multi-toggle]")).toHaveText("SSB");

    const submitResponsePromise = page.waitForResponse(
      (response) =>
        response.url() === `${server.origin}/api/activate-ri-2026/plans`,
    );
    await page.getByRole("button", { name: "Submit for review" }).click();
    const submitResponse = await submitResponsePromise;
    const submitBody = await submitResponse.text();
    if (submitResponse.status() !== 202) {
      throw new Error(
        `Unexpected submit response ${submitResponse.status()} ${submitResponse.headers()["content-type"]}:\n${submitBody.slice(0, 1000)}`,
      );
    }
    expect(submitResponse.headers()["content-type"]).toContain(
      "application/json",
    );
    expect(JSON.parse(submitBody)).toMatchObject({ ok: true });
    await expect(
      page.getByText("Submission received for organizer review."),
    ).toBeVisible();

    const pendingResponse = await request.get(
      `${server.origin}/api/activate-ri-2026/admin/plans`,
      {
        headers: {
          "Cf-Access-Authenticated-User-Email": "local-admin@ripota.org",
        },
      },
    );
    expect(pendingResponse.ok()).toBe(true);
    const pendingBody = (await pendingResponse.json()) as {
      plans: Array<{
        id: string;
        submitter_callsign: string;
        submitter_email: string;
      }>;
    };
    const pendingPlan = pendingBody.plans.find(
      (plan) =>
        plan.submitter_callsign === callsign && plan.submitter_email === email,
    );
    expect(pendingPlan).toBeDefined();

    const approveResponse = await request.post(
      `${server.origin}/api/activate-ri-2026/admin/plans/${pendingPlan?.id}/approve`,
      {
        headers: {
          "Cf-Access-Authenticated-User-Email": "local-admin@ripota.org",
        },
      },
    );
    expect(approveResponse.ok()).toBe(true);

    const publicResponse = await request.get(
      `${server.origin}/api/activate-ri-2026/public/stops`,
      {
        headers: { "cache-control": "no-cache" },
      },
    );
    expect(publicResponse.ok()).toBe(true);
    const publicBody = (await publicResponse.json()) as {
      stops: Array<{
        parkReference: string;
        activatorCallsign: string;
        plannedDate: string;
        startTime: string;
        endTime: string;
        bands: string[];
        modes: string[];
        status: string;
      }>;
    };
    expect(publicBody.stops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parkReference: "US-2868",
          activatorCallsign: callsign,
          plannedDate: "2026-09-11",
          startTime: "13:00",
          endTime: "16:00",
          bands: ["40m", "20m", "15m"],
          modes: ["SSB"],
          status: "scheduled",
        }),
      ]),
    );

    await page.route("**/api/activate-ri-2026/public/stops", async (route) => {
      const headers = {
        ...route.request().headers(),
        "cache-control": "no-cache",
      };
      await route.continue({ headers });
    });
    await page.goto(`${server.origin}/activate-ri-2026/schedule/`);
    const scheduleRow = page.getByRole("row", { name: new RegExp(callsign) });
    await expect(scheduleRow).toContainText("US-2868");
    await expect(scheduleRow).toContainText("Scheduled");

    await page.locator('[data-filter="activator"]').selectOption(callsign);
    await page.locator('[data-filter="band"]').selectOption("20m");
    await page.locator('[data-timezone]').selectOption("pacific");
    await expect(page).toHaveURL(new RegExp(`activator=${callsign}`));
    await expect(page).toHaveURL(/band=20m/);
    await expect(page).toHaveURL(/timezone=pacific/);

    await page.reload();
    await expect(page.locator('[data-filter="activator"]')).toHaveValue(callsign);
    await expect(page.locator('[data-filter="band"]')).toHaveValue("20m");
    await expect(page.locator('[data-timezone]')).toHaveValue("pacific");
    await expect(page.getByRole("row", { name: new RegExp(callsign) })).toBeVisible();
  } finally {
    await server.stop();
  }
});

test("volunteer map add activation scrolls to identity fields and skips duplicate parks", async ({
  page,
}) => {
  const server = await startActivateRiServer();

  try {
    await page.goto(`${server.origin}/activate-ri-2026/volunteer/`);

    await addParkFromVolunteerMap(page, "US-2868");

    await expect(page.getByLabel(/Callsign/).first()).toBeFocused();
    await expectParkReferences(page, ["US-2868"]);

    await addParkFromVolunteerMap(page, "US-2868");

    await expect(page.getByLabel(/Callsign/).first()).toBeFocused();
    await expect(page.locator("[data-stop-card]")).toHaveCount(1);
    await expectParkReferences(page, ["US-2868"]);
  } finally {
    await server.stop();
  }
});

test("additional parks inherit date, bands, and modes without copying stop details", async ({
  page,
}) => {
  const server = await startActivateRiServer();

  try {
    await page.goto(`${server.origin}/activate-ri-2026/volunteer/`);

    const firstStop = page.locator("[data-stop-card]").first();
    await firstStop.locator("[data-park-input]").fill("US-2868");
    await firstStop.getByRole("button", { name: "US-2868" }).click();
    await firstStop.locator("[data-planned-date]").selectOption("2026-09-12");
    await firstStop.locator("[data-time-block]").selectOption("09:00-12:00");
    await firstStop.locator("[data-public-notes]").fill("First stop only");
    await firstStop.locator("[data-bands] [data-multi-toggle]").click();
    await firstStop.locator('[data-bands] [value="40m"]').uncheck();
    await firstStop.locator('[data-bands] [value="10m"]').check();
    await firstStop.locator("[data-modes] [data-multi-toggle]").click();
    await firstStop.locator('[data-modes] [value="CW"]').check();

    await page.getByRole("button", { name: "Add another park" }).click();

    const secondStop = page.locator("[data-stop-card]").nth(1);
    await expect(secondStop.locator("[data-park-input]")).toHaveValue("");
    await expect(secondStop.locator("[data-park-reference]")).toHaveValue("");
    await expect(secondStop.locator("[data-planned-date]")).toHaveValue("2026-09-12");
    await expect(secondStop.locator("[data-time-block]")).toHaveValue("");
    await expect(secondStop.locator("[data-public-notes]")).toHaveValue("");
    await expect(secondStop.locator("[data-bands] [data-multi-toggle]")).toHaveText(
      "20m, 15m, 10m",
    );
    await expect(secondStop.locator("[data-modes] [data-multi-toggle]")).toHaveText(
      "SSB, CW",
    );
  } finally {
    await server.stop();
  }
});

async function addParkFromVolunteerMap(page: Page, reference: string): Promise<void> {
  await page.evaluate((selectedReference) => {
    document.dispatchEvent(
      new CustomEvent("activate-ri:add-park", {
        detail: { reference: selectedReference },
      }),
    );
  }, reference);
}

async function expectParkReferences(page: Page, references: string[]): Promise<void> {
  await expect
    .poll(async () =>
      page.locator("[data-park-reference]").evaluateAll((fields) =>
        fields.map((field) => (field as HTMLInputElement).value),
      ),
    )
    .toEqual(references);
}

function randomCallsign(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let suffix = "";
  for (let index = 0; index < 3; index += 1) {
    suffix += letters[Math.floor(Math.random() * letters.length)];
  }

  return `N0${suffix}`;
}
