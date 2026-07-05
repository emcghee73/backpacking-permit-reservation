import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const PERMIT_URL = "https://www.recreation.gov/permits/445859";
const buildAvailabilityUrl = (entryDate) =>
  `https://www.recreation.gov/permits/445859/registration/detailed-availability?date=${entryDate}&type=overnight-permit`;

const PROFILE_DIR = path.resolve(process.cwd(), "data/recreation-gov-profile");
const DIAGNOSTIC_DIR = path.resolve(os.tmpdir(), "backpacking-permit-reservation");
const HANDOFF_FILE = path.resolve(DIAGNOSTIC_DIR, "handoff-url.txt");

const FIXED_DETAILS = {
  travelMethod: "Foot",
  animals: "No",
  issuingStation: "Tuolumne Meadows Wilderness Center",
  lateArrival: "Yes",
};

function byLabel(text, exact = false) {
  return { kind: "label", text, exact };
}

function byRole(role, name, exact = false) {
  return { kind: "role", role, name, exact };
}

function bySelector(selector) {
  return { kind: "selector", selector };
}

const FIELD_CONFIG = {
  firstNightCamp: {
    description: "first-night camp location",
    strategies: [
      byLabel("Intended First Night's Camp Location", false),
      byLabel("First Night's Camp Location", false),
      byLabel("First Night Camp Location", false),
      bySelector('textarea[name*="camp"]'),
      bySelector('input[name*="camp"]'),
    ],
    tokenSets: [
      ["first", "night", "camp"],
      ["intended", "camp"],
    ],
    negativeTokens: ["emergency", "exit"],
  },
  exitPoint: {
    description: "exit point",
    strategies: [
      byLabel("Exit Point", false),
      byLabel("Exit Trailhead", false),
      bySelector('input[name*="exit"]'),
      bySelector('select[name*="exit"]'),
    ],
    tokenSets: [
      ["exit", "point"],
      ["exit", "trailhead"],
    ],
    negativeTokens: ["date"],
  },
  exitDate: {
    description: "exit date",
    strategies: [
      byLabel("Exit Date", false),
      bySelector('input[name*="exit"][type="date"]'),
      bySelector('input[name*="exit"][name*="date"]'),
    ],
    tokenSets: [
      ["exit", "date"],
    ],
    negativeTokens: ["entry"],
  },
  permitHolderFirstName: {
    description: "permit holder first name",
    strategies: [
      byLabel("Permit Holder First Name", false),
      byLabel("Reservation Holder First Name", false),
      byLabel("Primary Permit Holder First Name", false),
      bySelector('input[name*="permit"][name*="first"]'),
      bySelector('input[name*="holder"][name*="first"]'),
      bySelector('input[name*="leader"][name*="first"]'),
    ],
    tokenSets: [
      ["permit", "holder", "first", "name"],
      ["reservation", "holder", "first", "name"],
      ["trip", "leader", "first", "name"],
      ["primary", "first", "name"],
    ],
    negativeTokens: ["emergency"],
  },
  permitHolderLastName: {
    description: "permit holder last name",
    strategies: [
      byLabel("Permit Holder Last Name", false),
      byLabel("Reservation Holder Last Name", false),
      byLabel("Primary Permit Holder Last Name", false),
      bySelector('input[name*="permit"][name*="last"]'),
      bySelector('input[name*="holder"][name*="last"]'),
      bySelector('input[name*="leader"][name*="last"]'),
    ],
    tokenSets: [
      ["permit", "holder", "last", "name"],
      ["reservation", "holder", "last", "name"],
      ["trip", "leader", "last", "name"],
      ["primary", "last", "name"],
    ],
    negativeTokens: ["emergency"],
  },
  permitHolderEmail: {
    description: "permit holder email",
    strategies: [
      byLabel("Permit Holder Email", false),
      byLabel("Email Address", false),
      byLabel("Email", false),
      bySelector('input[type="email"]'),
      bySelector('input[name*="email"]'),
    ],
    tokenSets: [
      ["permit", "holder", "email"],
      ["email"],
    ],
    negativeTokens: ["emergency"],
  },
  permitHolderPhone: {
    description: "permit holder phone number",
    strategies: [
      byLabel("Permit Holder Phone", false),
      byLabel("Phone Number", false),
      byLabel("Phone", false),
      bySelector('input[type="tel"]'),
      bySelector('input[name*="phone"]'),
    ],
    tokenSets: [
      ["permit", "holder", "phone"],
      ["phone", "number"],
    ],
    negativeTokens: ["emergency"],
  },
  permitHolderAddress: {
    description: "permit holder address",
    strategies: [
      byLabel("Address", false),
      byLabel("Mailing Address", false),
      bySelector('textarea[name*="address"]'),
      bySelector('input[name*="address"]'),
    ],
    tokenSets: [
      ["mailing", "address"],
      ["address"],
    ],
    negativeTokens: ["emergency", "email"],
  },
  emergencyFirstName: {
    description: "emergency contact first name",
    strategies: [
      byLabel("Emergency Contact First Name", false),
      bySelector('input[name*="emergency"][name*="first"]'),
      bySelector('input[name*="contact"][name*="first"]'),
    ],
    tokenSets: [
      ["emergency", "contact", "first", "name"],
      ["contact", "first", "name"],
    ],
    negativeTokens: ["permit", "holder", "reservation"],
  },
  emergencyLastName: {
    description: "emergency contact last name",
    strategies: [
      byLabel("Emergency Contact Last Name", false),
      bySelector('input[name*="emergency"][name*="last"]'),
      bySelector('input[name*="contact"][name*="last"]'),
    ],
    tokenSets: [
      ["emergency", "contact", "last", "name"],
      ["contact", "last", "name"],
    ],
    negativeTokens: ["permit", "holder", "reservation"],
  },
  emergencyPhone: {
    description: "emergency contact phone number",
    strategies: [
      byLabel("Emergency Contact Phone", false),
      byLabel("Emergency Contact Phone Number", false),
      bySelector('input[name*="emergency"][name*="phone"]'),
      bySelector('input[name*="contact"][name*="phone"]'),
    ],
    tokenSets: [
      ["emergency", "contact", "phone"],
      ["contact", "phone", "number"],
    ],
    negativeTokens: ["permit", "holder", "reservation"],
  },
  travelMethod: {
    description: "travel method",
    strategies: [
      byLabel("Travel Method", false),
      byLabel("Method of Travel", false),
      bySelector('select[name*="travel"]'),
      bySelector('[role="combobox"][aria-label*="Travel"]'),
    ],
    tokenSets: [
      ["travel", "method"],
      ["method", "travel"],
    ],
    negativeTokens: [],
  },
  animals: {
    description: "animals selection",
    strategies: [
      byLabel("Animals", false),
      byLabel("Pack Animals", false),
      bySelector('select[name*="animal"]'),
      bySelector('[role="combobox"][aria-label*="Animal"]'),
    ],
    tokenSets: [
      ["animals"],
      ["pack", "animals"],
    ],
    negativeTokens: [],
  },
  issuingStation: {
    description: "issuing station",
    strategies: [
      byLabel("Issuing Station", false),
      byLabel("Permit Issuing Station", false),
      bySelector('select[name*="station"]'),
      bySelector('select[name*="issue"]'),
      bySelector('[role="combobox"][aria-label*="Station"]'),
    ],
    tokenSets: [
      ["issuing", "station"],
      ["permit", "station"],
    ],
    negativeTokens: [],
  },
  lateArrival: {
    description: "late arrival",
    strategies: [
      byLabel("Late Arrival", false),
      byLabel("Late Arrival?", false),
      bySelector('select[name*="late"]'),
      bySelector('[role="combobox"][aria-label*="Late"]'),
    ],
    tokenSets: [
      ["late", "arrival"],
    ],
    negativeTokens: [],
  },
  needToKnowAgreement: {
    description: "Need to Know agreement",
    strategies: [
      byRole("checkbox", "Yes, I have read and agree to the Need to Know information.", false),
      byLabel("Yes, I have read and agree to the Need to Know information.", false),
      byRole("radio", "Yes, I have read and agree to the Need to Know information.", false),
      bySelector('input[type="checkbox"][name*="need"]'),
      bySelector('input[type="radio"][value="Yes"]'),
    ],
    tokenSets: [
      ["need", "know", "agree"],
    ],
    negativeTokens: [],
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function parseIsoDate(value) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10) === value ? date : null;
}

function buildDateButtonFragment(entryDate) {
  const parsed = parseIsoDate(entryDate);
  if (!parsed) {
    throw new Error(`Invalid entry date: ${entryDate}`);
  }

  const weekday = parsed
    .toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: "UTC",
    })
    .toUpperCase();

  return `${weekday} ${parsed.getUTCDate()} People:`;
}

async function prompt(question, defaultValue = "") {
  const rl = readline.createInterface({ input, output });
  const suffix = defaultValue ? ` [${defaultValue}]` : "";

  try {
    const answer = await rl.question(`${question}${suffix}: `);
    return normalizeText(answer || defaultValue);
  } finally {
    rl.close();
  }
}

async function promptRequired(question, defaultValue = "") {
  while (true) {
    const answer = await prompt(question, defaultValue);
    if (answer) {
      return answer;
    }
    console.log("A value is required.");
  }
}

async function promptEnter(question) {
  const rl = readline.createInterface({ input, output });

  try {
    await rl.question(`${question}: `);
  } finally {
    rl.close();
  }
}

async function promptDate(question) {
  while (true) {
    const answer = await promptRequired(question);
    if (parseIsoDate(answer)) {
      return answer;
    }
    console.log("Enter the date as YYYY-MM-DD.");
  }
}

async function promptPositiveInteger(question) {
  while (true) {
    const answer = await promptRequired(question);
    const parsed = Number.parseInt(answer, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
    console.log("Enter a whole number greater than zero.");
  }
}

async function promptSecret(question) {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return await promptRequired(question);
  }

  output.write(`${question}: `);
  input.resume();
  input.setRawMode(true);
  input.setEncoding("utf8");

  let value = "";

  return await new Promise((resolve, reject) => {
    function cleanup() {
      input.removeListener("data", onData);
      input.setRawMode(false);
      output.write("\n");
    }

    function onData(chunk) {
      const char = String(chunk);

      if (char === "\u0003") {
        cleanup();
        reject(new Error("Prompt cancelled."));
        return;
      }

      if (char === "\r" || char === "\n") {
        cleanup();
        resolve(value);
        return;
      }

      if (char === "\u007f") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          output.write("\b \b");
        }
        return;
      }

      value += char;
      output.write("*");
    }

    input.on("data", onData);
  });
}

function parseTrailheadIds(value) {
  const ids = value
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);

  if (ids.length === 0) {
    return [];
  }

  const invalid = ids.find((id) => !/^\d+$/.test(id));
  if (invalid) {
    throw new Error(`Trailhead IDs must be numeric. Invalid value: ${invalid}`);
  }

  return ids;
}

async function promptTrailheads() {
  while (true) {
    try {
      const rawIds = await promptRequired("Trailhead IDs in priority order (comma-separated)");
      const ids = parseTrailheadIds(rawIds);

      if (ids.length === 0) {
        console.log("Enter at least one trailhead ID.");
        continue;
      }

      const trailheads = [];
      for (const id of ids) {
        const firstNightCamp = await promptRequired(
          `Intended first-night camp location text for trailhead ${id}`
        );
        trailheads.push({ id, firstNightCamp });
      }

      return trailheads;
    } catch (error) {
      console.log(error.message);
    }
  }
}

async function collectPermitRequest() {
  console.log("");
  console.log("Backpacking permit reservation intake");
  console.log("");

  const accountEmail = await promptRequired(
    "Recreation.gov login email",
    process.env.RECREATION_GOV_USERNAME ?? ""
  );
  let accountPassword =
    process.env.RECREATION_GOV_PASSWORD && normalizeText(process.env.RECREATION_GOV_PASSWORD)
      ? normalizeText(process.env.RECREATION_GOV_PASSWORD)
      : "";

  while (!accountPassword) {
    accountPassword = normalizeText(await promptSecret("Recreation.gov password"));
    if (!accountPassword) {
      console.log("A value is required.");
    }
  }

  const groupSize = await promptPositiveInteger("Number of people on the permit");
  const entryDate = await promptDate("Entry date");
  const trailheads = await promptTrailheads();
  const exitPoint = await promptRequired("Exit point");
  let exitDate = await promptDate("Exit date");
  while (exitDate < entryDate) {
    console.log("Exit date must be on or after the entry date.");
    exitDate = await promptDate("Exit date");
  }

  const permitHolder = {
    firstName: await promptRequired("Permit holder first name"),
    lastName: await promptRequired("Permit holder last name"),
    email: await promptRequired("Permit holder email"),
    phone: await promptRequired("Permit holder phone number"),
    address: await promptRequired("Permit holder address"),
  };

  const emergencyContact = {
    firstName: await promptRequired("Emergency contact first name"),
    lastName: await promptRequired("Emergency contact last name"),
    phone: await promptRequired("Emergency contact phone number"),
  };

  return {
    account: {
      email: accountEmail,
      password: accountPassword,
    },
    groupSize,
    entryDate,
    trailheads,
    exitPoint,
    exitDate,
    permitHolder,
    emergencyContact,
  };
}

async function isVisible(locator) {
  return await locator.isVisible().catch(() => false);
}

async function resolveStrategyLocator(page, strategy) {
  if (strategy.kind === "label") {
    return page.getByLabel(strategy.text, { exact: strategy.exact });
  }

  if (strategy.kind === "role") {
    return page.getByRole(strategy.role, {
      name: strategy.name,
      exact: strategy.exact,
    });
  }

  return page.locator(strategy.selector);
}

async function findDirectLocator(page, config) {
  for (const strategy of config.strategies) {
    const locator = await resolveStrategyLocator(page, strategy);
    const count = await locator.count().catch(() => 0);
    if (count !== 1) {
      continue;
    }

    if (await isVisible(locator)) {
      return locator;
    }
  }

  return null;
}

async function getFormControlInventory(page) {
  return await page.evaluate(() => {
    const elements = Array.from(
      document.querySelectorAll(
        'input:not([type="hidden"]), textarea, select, [role="combobox"], [role="checkbox"], [role="radio"]'
      )
    );

    const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();

    return elements
      .map((element, index) => {
        const htmlElement = element;
        const style = window.getComputedStyle(htmlElement);
        const rect = htmlElement.getBoundingClientRect();
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none";

        if (!visible || htmlElement.hasAttribute("disabled")) {
          return null;
        }

        const automationId =
          htmlElement.getAttribute("data-permit-automation-id") ?? `permit-${Date.now()}-${index}`;
        htmlElement.setAttribute("data-permit-automation-id", automationId);

        const labels = new Set();

        if (htmlElement instanceof HTMLElement) {
          const wrappingLabel = htmlElement.closest("label");
          if (wrappingLabel) {
            labels.add(normalize(wrappingLabel.innerText));
          }
        }

        if ("labels" in htmlElement && htmlElement.labels) {
          for (const label of Array.from(htmlElement.labels)) {
            labels.add(normalize(label.innerText));
          }
        }

        const ariaLabelledBy = htmlElement.getAttribute("aria-labelledby");
        if (ariaLabelledBy) {
          for (const id of ariaLabelledBy.split(/\s+/)) {
            const labelledNode = document.getElementById(id);
            if (labelledNode) {
              labels.add(normalize(labelledNode.textContent));
            }
          }
        }

        const fieldset = htmlElement.closest("fieldset");
        if (fieldset) {
          const legend = fieldset.querySelector("legend");
          if (legend) {
            labels.add(normalize(legend.textContent));
          }
        }

        const tagName = htmlElement.tagName.toLowerCase();
        const role = htmlElement.getAttribute("role") || "";
        const type = htmlElement.getAttribute("type") || "";
        const name = htmlElement.getAttribute("name") || "";
        const id = htmlElement.getAttribute("id") || "";
        const placeholder = htmlElement.getAttribute("placeholder") || "";
        const ariaLabel = htmlElement.getAttribute("aria-label") || "";
        const optionTexts =
          tagName === "select"
            ? Array.from(htmlElement.querySelectorAll("option"))
                .map((option) => normalize(option.textContent))
                .filter(Boolean)
            : [];

        const searchText = normalize(
          [
            ...labels,
            ariaLabel,
            placeholder,
            name,
            id,
            optionTexts.join(" "),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
        );

        return {
          automationId,
          tagName,
          role,
          type,
          searchText,
          optionTexts: optionTexts.map((value) => value.toLowerCase()),
        };
      })
      .filter(Boolean);
  });
}

function scoreControl(control, config) {
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const tokenSet of config.tokenSets) {
    let score = 0;
    let hits = 0;

    for (const token of tokenSet) {
      if (control.searchText.includes(token)) {
        score += 10;
        hits += 1;
      } else {
        score -= 5;
      }
    }

    if (hits === 0) {
      continue;
    }

    if (control.tagName === "input" || control.tagName === "textarea" || control.tagName === "select") {
      score += 2;
    }

    if (control.role === "combobox") {
      score += 1;
    }

    for (const token of config.negativeTokens) {
      if (control.searchText.includes(token)) {
        score -= 14;
      }
    }

    bestScore = Math.max(bestScore, score);
  }

  return bestScore;
}

async function findFuzzyLocator(page, config) {
  const controls = await getFormControlInventory(page);
  const scored = controls
    .map((control) => ({
      control,
      score: scoreControl(control, config),
    }))
    .filter((item) => Number.isFinite(item.score) && item.score >= 12)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return null;
  }

  if (scored.length > 1 && scored[0].score - scored[1].score < 3) {
    return null;
  }

  return page.locator(`[data-permit-automation-id="${scored[0].control.automationId}"]`);
}

async function resolveFieldLocator(page, fieldKey) {
  const config = FIELD_CONFIG[fieldKey];
  const direct = await findDirectLocator(page, config);
  if (direct) {
    return direct;
  }

  return await findFuzzyLocator(page, config);
}

async function getElementMeta(locator) {
  return await locator.evaluate((element) => ({
    tagName: element.tagName.toLowerCase(),
    type: element.getAttribute("type") || "",
    role: element.getAttribute("role") || "",
  }));
}

async function fillTextLikeField(page, fieldKey, value) {
  const locator = await resolveFieldLocator(page, fieldKey);
  if (!locator) {
    throw new Error(`Unable to find the ${FIELD_CONFIG[fieldKey].description} field.`);
  }

  const meta = await getElementMeta(locator);

  if (meta.tagName === "select") {
    await locator.selectOption({ label: value });
    return;
  }

  await locator.fill(value);
}

async function selectChoiceField(page, fieldKey, value) {
  const locator = await resolveFieldLocator(page, fieldKey);
  if (!locator) {
    throw new Error(`Unable to find the ${FIELD_CONFIG[fieldKey].description} control.`);
  }

  const meta = await getElementMeta(locator);

  if (meta.tagName === "select") {
    await locator.selectOption({ label: value });
    return;
  }

  await locator.click();
  await sleep(500);

  const optionCandidates = [
    page.getByRole("option", { name: value, exact: true }),
    page.getByRole("radio", { name: value, exact: true }),
    page.getByText(value, { exact: true }),
  ];

  for (const optionLocator of optionCandidates) {
    const count = await optionLocator.count().catch(() => 0);
    if (count === 1 && (await isVisible(optionLocator))) {
      await optionLocator.click();
      return;
    }
  }

  throw new Error(
    `Found the ${FIELD_CONFIG[fieldKey].description} control, but could not choose "${value}".`
  );
}

async function acceptNeedToKnow(page) {
  const locator = await resolveFieldLocator(page, "needToKnowAgreement");
  if (!locator) {
    throw new Error("Unable to find the Need to Know agreement control.");
  }

  const meta = await getElementMeta(locator);
  if (meta.type === "checkbox" || meta.type === "radio") {
    await locator.check();
    return;
  }

  await locator.click();
}

async function captureDiagnostics(page, label) {
  await ensureDir(DIAGNOSTIC_DIR);
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const pngPath = path.resolve(DIAGNOSTIC_DIR, `${label}-${stamp}.png`);
  const htmlPath = path.resolve(DIAGNOSTIC_DIR, `${label}-${stamp}.html`);

  await page.screenshot({ path: pngPath, fullPage: true }).catch(() => {});
  await fs.writeFile(htmlPath, await page.content(), "utf8").catch(() => {});

  return { pngPath, htmlPath };
}

async function ensureSignedIn(page, account) {
  await page.goto(PERMIT_URL, { waitUntil: "domcontentloaded" });
  await page.bringToFront().catch(() => {});

  const loginButton = page.getByRole("button", {
    name: "Sign Up or Log In",
    exact: true,
  });

  if (!(await isVisible(loginButton))) {
    console.log("Recreation.gov already appears to be signed in.");
    return;
  }

  console.log("Signing into Recreation.gov...");
  await loginButton.click();

  const emailField = page.getByRole("textbox", {
    name: "Email (Required)",
    exact: true,
  });
  const passwordField = page.getByRole("textbox", {
    name: "Password (Required)",
    exact: true,
  });

  await emailField.fill(account.email);
  await passwordField.fill(account.password);
  await page.getByRole("button", { name: "Log In", exact: true }).click();

  const loginDeadline = Date.now() + 15000;
  while (Date.now() < loginDeadline) {
    if (!(await isVisible(loginButton))) {
      return;
    }

    const loginDialog = page.getByRole("dialog", {
      name: "Log In to Recreation.gov",
      exact: false,
    });

    if (!(await isVisible(loginDialog))) {
      return;
    }

    await sleep(500);
  }

  console.log("");
  console.log("Additional sign-in verification appears to be required.");
  console.log("Complete any sign-in challenge in the opened browser window, then continue here.");
  await promptEnter("Press Enter once Recreation.gov shows you as signed in");
}

async function setGroupSize(page, groupSize) {
  console.log(`Setting group size to ${groupSize}...`);
  const groupMembersButton = page.getByRole("button", {
    name: "Add Group Members...",
    exact: true,
  });

  await groupMembersButton.click();
  const peopleField = page.getByRole("textbox", {
    name: "Number of Peoples",
    exact: true,
  });
  await peopleField.fill(String(groupSize));
  await page.getByRole("button", { name: "Close", exact: true }).click();

  const infoHeading = page.getByRole("heading", {
    name: "Information Required",
    exact: true,
  });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (!(await isVisible(infoHeading))) {
      return;
    }
    await sleep(500);
  }
}

async function findTrailheadRow(page, trailheadId) {
  const row = page
    .locator('[role="row"]')
    .filter({
      has: page.getByRole("gridcell", {
        name: trailheadId,
        exact: true,
      }),
    });

  const count = await row.count().catch(() => 0);
  return count === 1 ? row : null;
}

async function selectTrailheadByPriority(page, request) {
  console.log("Opening the availability grid...");
  await page.goto(buildAvailabilityUrl(request.entryDate), {
    waitUntil: "domcontentloaded",
  });

  await setGroupSize(page, request.groupSize);

  const dateFragment = buildDateButtonFragment(request.entryDate);
  const bookNowButton = page.getByRole("button", {
    name: "Book Now",
    exact: true,
  });

  for (const trailhead of request.trailheads) {
    console.log(`Checking trailhead ${trailhead.id}...`);
    const row = await findTrailheadRow(page, trailhead.id);
    if (!row) {
      console.log(`Trailhead ${trailhead.id} was not present in the current table view.`);
      continue;
    }

    const availabilityButton = row.getByRole("button", {
      name: dateFragment,
      exact: false,
    });

    const buttonCount = await availabilityButton.count().catch(() => 0);
    if (buttonCount !== 1) {
      console.log(`Trailhead ${trailhead.id} does not have a clickable slot for ${request.entryDate}.`);
      continue;
    }

    if (!(await availabilityButton.isEnabled().catch(() => false))) {
      console.log(`Trailhead ${trailhead.id} is visible but not bookable for ${request.entryDate}.`);
      continue;
    }

    await availabilityButton.click();

    const enableDeadline = Date.now() + 5000;
    while (Date.now() < enableDeadline) {
      if (await bookNowButton.isEnabled().catch(() => false)) {
        console.log(`Selected trailhead ${trailhead.id}.`);
        return trailhead;
      }
      await sleep(250);
    }

    const clearDatesButton = page.getByRole("button", {
      name: "Clear Dates that were selected",
      exact: true,
    });

    if (await isVisible(clearDatesButton)) {
      await clearDatesButton.click().catch(() => {});
      await sleep(500);
    }
  }

  throw new Error(
    `None of the requested trailheads had availability on ${request.entryDate}.`
  );
}

async function waitForReservationForm(page) {
  const detectionFields = [
    "firstNightCamp",
    "exitPoint",
    "travelMethod",
    "issuingStation",
  ];

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    for (const fieldKey of detectionFields) {
      const locator = await resolveFieldLocator(page, fieldKey);
      if (locator && (await isVisible(locator))) {
        return;
      }
    }
    await sleep(750);
  }

  console.log("");
  console.log("The reservation-details form did not appear automatically.");
  console.log("If Recreation.gov opened an intermediate screen, advance to the permit details form in the browser window now.");
  await promptEnter("Press Enter once the permit details form is visible");
}

async function continueToDetailsPage(page) {
  const bookNowButton = page.getByRole("button", {
    name: "Book Now",
    exact: true,
  });

  if (!(await bookNowButton.isEnabled().catch(() => false))) {
    throw new Error("Book Now is not enabled after selecting a trailhead.");
  }

  console.log("Opening the reservation details screen...");
  await bookNowButton.click();
  await sleep(2000);
  await waitForReservationForm(page);
}

async function fillReservationForm(page, request, selectedTrailhead) {
  console.log("Filling the reservation form...");

  await fillTextLikeField(page, "firstNightCamp", selectedTrailhead.firstNightCamp);
  await fillTextLikeField(page, "exitPoint", request.exitPoint);
  await fillTextLikeField(page, "exitDate", request.exitDate);

  await fillTextLikeField(page, "permitHolderFirstName", request.permitHolder.firstName);
  await fillTextLikeField(page, "permitHolderLastName", request.permitHolder.lastName);
  await fillTextLikeField(page, "permitHolderEmail", request.permitHolder.email);
  await fillTextLikeField(page, "permitHolderPhone", request.permitHolder.phone);
  await fillTextLikeField(page, "permitHolderAddress", request.permitHolder.address);

  await fillTextLikeField(page, "emergencyFirstName", request.emergencyContact.firstName);
  await fillTextLikeField(page, "emergencyLastName", request.emergencyContact.lastName);
  await fillTextLikeField(page, "emergencyPhone", request.emergencyContact.phone);

  await selectChoiceField(page, "travelMethod", FIXED_DETAILS.travelMethod);
  await selectChoiceField(page, "animals", FIXED_DETAILS.animals);
  await selectChoiceField(page, "issuingStation", FIXED_DETAILS.issuingStation);
  await selectChoiceField(page, "lateArrival", FIXED_DETAILS.lateArrival);
  await acceptNeedToKnow(page);
}

async function launchBrowser() {
  await ensureDir(PROFILE_DIR);

  return await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 960 },
  });
}

async function writeHandoffUrl(url) {
  await ensureDir(DIAGNOSTIC_DIR);
  await fs.writeFile(HANDOFF_FILE, `${url}\n`, "utf8");
}

async function holdForHandoff() {
  console.log("");
  console.log("The browser is staying open so you can take over manually.");
  console.log("Press Enter here when you are finished and want the automation to close the browser.");
  await promptEnter("Ready to close the browser");
}

export async function main() {
  const request = await collectPermitRequest();
  const context = await launchBrowser();
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(20000);

  try {
    await ensureSignedIn(page, request.account);
    const selectedTrailhead = await selectTrailheadByPriority(page, request);
    await continueToDetailsPage(page);
    await fillReservationForm(page, request, selectedTrailhead);
    await page.bringToFront().catch(() => {});

    const handoffUrl = page.url();
    await writeHandoffUrl(handoffUrl);

    console.log("");
    console.log(`Selected trailhead: ${selectedTrailhead.id}`);
    console.log(`Handoff URL: ${handoffUrl}`);
    console.log(`Saved handoff URL to ${HANDOFF_FILE}`);
    await holdForHandoff();
  } catch (error) {
    const diagnostics = await captureDiagnostics(page, "permit-reservation-error");
    console.error("");
    console.error(error.message);
    console.error(`Saved diagnostics to ${diagnostics.pngPath} and ${diagnostics.htmlPath}`);
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch(() => {
    process.exitCode = 1;
  });
}
