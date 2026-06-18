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
