import { expect, type Page, test } from "@playwright/test";
import { startActivateRiServer } from "./helpers/activate-ri-server";

test.setTimeout(60_000);

test("activator edit link shows one merged stop list for repeated submissions", async ({
  page,
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

function randomCallsign(): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let suffix = "";
  for (let index = 0; index < 3; index += 1) {
    suffix += letters[Math.floor(Math.random() * letters.length)];
  }

  return `N0${suffix}`;
}
