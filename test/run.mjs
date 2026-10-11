// End-to-end checks against local fixtures that mimic Recreation.gov's
// availability grid, login dialog, and reservation form. Run with `npm test`.
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { internals as I } from "../src/backpacking-permit-reservation.mjs";

const fixtureDir = path.resolve(import.meta.dirname, "fixture");
const fixtureUrl = (params) =>
  pathToFileURL(path.resolve(fixtureDir, "availability.html")).href +
  "?" +
  new URLSearchParams(params).toString();

const genericFormValues = {
  "permitHolder.firstName": "Pat", "permitHolder.lastName": "Hiker", "permitHolder.email": "pat@example.com",
  "permitHolder.phone": "5551234567", "permitHolder.address": "1 Trail Rd", "emergency.firstName": "", "emergency.phone": "",
  travelMethod: "Foot", animals: "No", issuingStation: "Tuolumne Meadows Wilderness Center", lateArrival: "Yes", needToKnow: true,
};
const realFormValues = (overrides = {}) => ({
  first_name: "Account", last_name: "Holder", email: "account@example.com", cell_phone_req: "5551234567",
  country: "United States", address1: "1 Main St", "suite-number": "", city: "Springfield", state: "California", zip_code: "90000",
  "save-leader-checkbox": false, "emergency-contact-firstname": "", "emergency-contact-lastname": "", "emergency-contact-phone-num": "",
  "entry-point": "May Lake", "input-takeout-point": "", "comments-text-area-1": "",
  "travel-method": "Foot", "bringing-animal-yes": false, "bringing-animal-no": true,
  "issue-station": "Tuolumne Meadows Wilderness Center", "late-arrival-yes": true, "late-arrival-no": false, "need-to-know": true,
  ...overrides,
});

const SCENARIOS = [
  { name: "generic labels", params: { form: "form" }, expectForm: genericFormValues },
  { name: "real form (locked name/email, hidden radios)", params: { form: "form-real" }, expectForm: realFormValues() },
  { name: "rows render late", params: { form: "form-real", delay: 200 }, expectForm: realFormValues() },
  { name: "date param rewritten, shell draws late, date typed in", params: { form: "form-real", mode: "today", date: "2026-10-01" }, expectForm: realFormValues() },
  { name: "released only after two refreshes (scheduled run)", params: { form: "form-real", releaseAfter: 2 }, runPlan: { mode: "later", timeZone: "America/Los_Angeles" }, expectForm: realFormValues() },
  { name: "group size remembered by the site", params: { form: "form-real", remembered: 1 }, groupSize: 2, expectForm: realFormValues() },
  { name: "Paria Canyon single row", params: { form: "form-real", single: 1 }, destination: "paria", expectName: "Paria Canyon Overnight", expectRow: "0", expectForm: realFormValues({ "issue-station": "Select Option" }) },
  { name: "first date not yet released, second date booked", params: { form: "form-real", nr: 1 }, entryDates: ["2026-10-01", "2026-10-02"], expectDate: "2026-10-02", expectCol: "2", expectForm: realFormValues() },
  // Lyell Canyon (row 4) is open on the first date only; Cathedral Lakes (row 2) on the second date only.
  { name: "dates first: takes Lyell on date 1", params: { form: "form-real", col1Rows: "4", col2Rows: "2" }, entryDates: ["2026-10-01", "2026-10-02"], trailheads: ["Cathedral Lakes", "Lyell Canyon"], priority: "dates", expectName: "Lyell Canyon", expectRow: "4", expectDate: "2026-10-01", expectCol: "1", expectForm: realFormValues() },
  { name: "trailheads first: takes Cathedral on date 2", params: { form: "form-real", col1Rows: "4", col2Rows: "2" }, entryDates: ["2026-10-01", "2026-10-02"], trailheads: ["Cathedral Lakes", "Lyell Canyon"], priority: "trailheads", expectName: "Cathedral Lakes", expectRow: "2", expectDate: "2026-10-02", expectCol: "2", expectForm: realFormValues() },
];

async function runScenario(scenario) {
  const url = fixtureUrl(scenario.params);
  const destination = { ...I.FACILITIES[scenario.destination ?? "yosemite"], buildAvailabilityUrl: () => url };
  const request = {
    destination,
    account: { email: "user@example.com", password: "hunter2" },
    groupSize: scenario.groupSize ?? 3,
    entryDates: scenario.entryDates ?? ["2026-10-01"],
    trailheads: destination.fixedTrailheads ?? (scenario.trailheads ?? ["Aspen Valley", "Cathedral Lakes Yosemite", "Lyell Canyon"]).map((name) => ({ name })),
    priority: scenario.priority ?? "dates",
    permitHolder: { firstName: "Pat", lastName: "Hiker", email: "pat@example.com", phone: "5551234567", address: "1 Trail Rd" },
    runPlan: scenario.runPlan,
  };

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.setDefaultTimeout(20000);
  const timings = {};
  const log = console.log;
  console.log = () => {};
  try {
    let t0 = performance.now();
    await I.ensureSignedIn(page, request);
    timings.signIn = performance.now() - t0;
    assert.equal(await page.locator("#loginBtn").count(), 0, "login button should be gone after sign-in");

    t0 = performance.now();
    const selected = await I.selectTrailheadByPriority(page, request);
    timings.selectTrailhead = performance.now() - t0;
    assert.equal(selected.displayName, scenario.expectName ?? "Cathedral Lakes");
    assert.equal(selected.entryDate, scenario.expectDate ?? "2026-10-01");
    assert.equal(await page.evaluate(() => window.__selected), scenario.expectRow ?? "2");
    assert.equal(await page.evaluate(() => window.__selectedCol), scenario.expectCol ?? "1");

    t0 = performance.now();
    await page.getByRole("button", { name: "Book Now", exact: true }).click();
    await I.waitForReservationForm(page, request.account);
    timings.waitForForm = performance.now() - t0;

    t0 = performance.now();
    await I.fillReservationForm(page, request);
    timings.fillForm = performance.now() - t0;
    const values = await page.evaluate(() =>
      Object.fromEntries(
        Array.from(document.querySelectorAll("input,select,textarea")).map((e) => [
          e.id || e.name,
          e.type === "checkbox" || e.type === "radio" ? e.checked : e.value,
        ])
      )
    );
    assert.deepEqual(values, scenario.expectForm);
  } finally {
    console.log = log;
    await browser.close();
  }
  return timings;
}

let failures = 0;
for (const scenario of SCENARIOS) {
  try {
    const timings = await runScenario(scenario);
    const summary = Object.entries(timings).map(([k, v]) => `${k} ${v.toFixed(0)} ms`).join(", ");
    console.log(`PASS  ${scenario.name}  (${summary})`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${scenario.name}\n${error.stack ?? error}`);
  }
}
console.log(failures === 0 ? `\nAll ${SCENARIOS.length} scenarios passed.` : `\n${failures} of ${SCENARIOS.length} scenarios failed.`);
process.exitCode = failures === 0 ? 0 : 1;
