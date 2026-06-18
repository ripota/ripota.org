import { expect, type APIRequestContext, type Page, test } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

test("activator edit link shows one merged stop list for repeated submissions", async ({
  page,
  request,
}) => {
  const server = await startActivateRiServer();
  const callsign = randomCallsign();
  const email = `${callsign.toLowerCase()}@example.com`;

  try {
    const firstEditUrl = await submitVolunteerStop(page, server.origin, {
      callsign,
      email,
      park: "US-2868",
      date: "2026-09-11",
      timeBlock: "13:00-16:00",
      band: "40m",
      mode: "SSB",
    });
    await approvePendingActivator(request, server.origin, callsign, email);

    const secondEditUrl = await submitVolunteerStop(page, server.origin, {
      callsign,
      email,
      park: "US-2869",
      date: "2026-09-12",
      timeBlock: "10:00-13:00",
      band: "20m",
      mode: "CW",
    });
    expect(secondEditUrl).not.toBe(firstEditUrl);
    await expectPublicStops(request, server.origin, callsign, [
      "US-2868",
      "US-2869",
    ]);

    await page.route("**/api/activate-ri-2026/public/stops", async (route) => {
      const headers = {
        ...route.request().headers(),
        "cache-control": "no-cache",
      };
      await route.continue({ headers });
    });
    await page.goto(`${server.origin}/activate-ri-2026/schedule/`);
    const firstScheduleRow = page.getByRole("row", {
      name: new RegExp(`US-2868.*${callsign}`),
    });
    const secondScheduleRow = page.getByRole("row", {
      name: new RegExp(`US-2869.*${callsign}`),
    });
    await expect(firstScheduleRow).toContainText("Scheduled");
    await expect(secondScheduleRow).toContainText("Scheduled");

    await page.goto(secondEditUrl);

    await expect(page.getByLabel("Activation plan")).toHaveCount(0);
    await expect(page.getByLabel(/Callsign/).first()).toHaveValue(callsign);
    await expect(page.locator("[data-stop-card]")).toHaveCount(2);
    await expect(page.locator("[data-stop-card]").first()).toContainText(
      "US-2868",
    );
    await expect(page.locator("[data-stop-card]").nth(1)).toContainText(
      "US-2869",
    );
  } finally {
    await server.stop();
  }
});

test("activator edit map add activation scrolls to identity fields and skips duplicate parks", async ({
  page,
}) => {
  const server = await startActivateRiServer();
  const callsign = randomCallsign();
  const email = `${callsign.toLowerCase()}@example.com`;

  try {
    const editUrl = await submitVolunteerStop(page, server.origin, {
      callsign,
      email,
      park: "US-2868",
      date: "2026-09-11",
      timeBlock: "13:00-16:00",
      band: "40m",
      mode: "SSB",
    });

    await page.goto(editUrl);
    await expect(page.getByLabel(/Callsign/).first()).toHaveValue(callsign);
    await expectParkReferences(page, ["US-2868"]);

    await addParkFromMap(page, "US-2868");

    await expect(page.getByLabel(/Callsign/).first()).toBeFocused();
    await expect(page.locator("[data-stop-card]")).toHaveCount(1);
    await expectParkReferences(page, ["US-2868"]);
  } finally {
    await server.stop();
  }
});

async function approvePendingActivator(
  request: APIRequestContext,
  origin: string,
  callsign: string,
  email: string,
): Promise<void> {
  const pendingResponse = await request.get(
    `${origin}/api/activate-ri-2026/admin/plans`,
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
    `${origin}/api/activate-ri-2026/admin/plans/${pendingPlan?.id}/approve`,
    {
      headers: {
        "Cf-Access-Authenticated-User-Email": "local-admin@ripota.org",
      },
    },
  );
  expect(approveResponse.ok()).toBe(true);
}

async function expectPublicStops(
  request: APIRequestContext,
  origin: string,
  callsign: string,
  parkReferences: string[],
): Promise<void> {
  const publicResponse = await request.get(
    `${origin}/api/activate-ri-2026/public/stops`,
    {
      headers: { "cache-control": "no-cache" },
    },
  );
  expect(publicResponse.ok()).toBe(true);
  const publicBody = (await publicResponse.json()) as {
    stops: Array<{
      activatorCallsign: string;
      parkReference: string;
      status: string;
    }>;
  };
  for (const parkReference of parkReferences) {
    expect(publicBody.stops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activatorCallsign: callsign,
          parkReference,
          status: "scheduled",
        }),
      ]),
    );
  }
}

async function submitVolunteerStop(
  page: Page,
  origin: string,
  options: {
    callsign: string;
    email: string;
    park: string;
    date: string;
    timeBlock: string;
    band: string;
    mode: string;
  },
): Promise<string> {
  await page.goto(`${origin}/activate-ri-2026/volunteer/`);

  await page.getByLabel(/Callsign/).first().fill(options.callsign);
  await page.getByLabel(/Name/).first().fill("Rob Jackson");
  await page.getByLabel(/Email/).first().fill(options.email);
  await page.getByLabel("Club / group affiliation").fill("RI POTA");
  await page.locator("[data-park-input]").fill(options.park);
  await page.getByRole("button", { name: options.park }).click();
  await page.locator("[data-planned-date]").selectOption(options.date);
  await page.locator("[data-time-block]").selectOption(options.timeBlock);

  await page.getByRole("button", { name: "Choose bands" }).click();
  await page.getByLabel(options.band).check();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Choose modes" }).click();
  await page.getByLabel(options.mode).check();
  await page.keyboard.press("Escape");

  const submitResponsePromise = page.waitForResponse(
    (response) => response.url() === `${origin}/api/activate-ri-2026/plans`,
  );
  await page.getByRole("button", { name: "Submit for review" }).click();
  const submitResponse = await submitResponsePromise;
  const submitBody = (await submitResponse.json()) as { editUrl?: string };
  await expect(
    page.getByText("Submission received for organizer review."),
  ).toBeVisible();
  expect(submitBody.editUrl).toBeTruthy();

  return submitBody.editUrl ?? "";
}

async function addParkFromMap(page: Page, reference: string): Promise<void> {
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
