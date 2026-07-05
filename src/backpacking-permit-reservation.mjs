#!/usr/bin/env node

import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const WORKSPACE_DIR = process.cwd();
const RUNTIME_DIR = path.resolve(WORKSPACE_DIR, ".backpacking-permit-reservation");
const PROFILE_DIR = path.resolve(RUNTIME_DIR, "browser-profile");
const DIAGNOSTIC_DIR = path.resolve(RUNTIME_DIR, "diagnostics");
const HANDOFF_FILE = path.resolve(RUNTIME_DIR, "handoff-url.txt");
const DEFAULT_RUN_TIME_ZONE = "America/Los_Angeles";
const FIELD_RESOLUTION_CACHE = new WeakMap();

const FACILITIES = {
  yosemite: {
    key: "yosemite",
    label: "Yosemite",
    permitUrl: "https://www.recreation.gov/permits/445859",
    buildAvailabilityUrl: (entryDate) =>
      `https://www.recreation.gov/permits/445859/registration/detailed-availability?date=${entryDate}&type=overnight-permit`,
    trailheadNameSuffixes: ["Yosemite"],
    fixedDetails: {
      travelMethod: { value: "Foot", required: true },
      animals: { value: "No", required: true },
      issuingStation: {
        value: "Tuolumne Meadows Wilderness Center",
        required: true,
      },
      lateArrival: { value: "Yes", required: true },
    },
  },
  inyo: {
    key: "inyo",
    label: "Inyo",
    permitUrl: "https://www.recreation.gov/permits/233262",
    buildAvailabilityUrl: (entryDate) =>
      `https://www.recreation.gov/permits/233262/registration/detailed-availability?date=${entryDate}`,
    trailheadNameSuffixes: ["Inyo", "Inyo National Forest"],
    availabilitySetup: {
      commercialGuidedTrip: "No",
      permitType: "Overnight",
    },
    fixedDetails: {
      travelMethod: { value: "Foot", required: false },
      animals: { value: "No", required: false },
      issuingStation: {
        value: "Tuolumne Meadows Wilderness Center",
        required: false,
      },
      lateArrival: { value: "Yes", required: false },
    },
  },
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

async function waitForCondition(check, { timeoutMs, intervalMs = 100 }) {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const result = await check();
    if (result) {
      return result;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return null;
    }

    await sleep(Math.min(intervalMs, remainingMs));
  }
}

function createTimingTracker() {
  const marks = new Map([["start", performance.now()]]);

  return {
    mark(name) {
      marks.set(name, performance.now());
    },
    has(name) {
      return marks.has(name);
    },
    durationMs(startName, endName) {
      const start = marks.get(startName);
      const end = marks.get(endName);
      if (typeof start !== "number" || typeof end !== "number") {
        return null;
      }
      return Math.max(0, end - start);
    },
    elapsedSince(startName) {
      const start = marks.get(startName);
      if (typeof start !== "number") {
        return null;
      }
      return Math.max(0, performance.now() - start);
    },
  };
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) {
    return "n/a";
  }

  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }

  if (ms < 10000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }

  return `${(ms / 1000).toFixed(1)} s`;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function parseTimeOfDay(value) {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return null;
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function isValidTimeZone(value) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function getTimeZoneParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function formatInstantInTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
}

function zonedDateTimeToDate(dateValue, timeValue, timeZone) {
  const parsedDate = parseIsoDate(dateValue);
  if (!parsedDate) {
    throw new Error("Enter the run date as YYYY-MM-DD.");
  }

  const parsedTime = parseTimeOfDay(timeValue);
  if (!parsedTime) {
    throw new Error("Enter the run time as HH:MM in 24-hour time.");
  }

  if (!isValidTimeZone(timeZone)) {
    throw new Error(
      "Enter a valid IANA time zone such as America/Los_Angeles."
    );
  }

  const desired = {
    year: parsedDate.getUTCFullYear(),
    month: parsedDate.getUTCMonth() + 1,
    day: parsedDate.getUTCDate(),
    hour: parsedTime.hour,
    minute: parsedTime.minute,
    second: 0,
  };

  const desiredAsUtcMs = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second
  );

  let guessMs = desiredAsUtcMs;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const actual = getTimeZoneParts(new Date(guessMs), timeZone);
    const actualAsUtcMs = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    const diffMs = desiredAsUtcMs - actualAsUtcMs;

    if (diffMs === 0) {
      break;
    }

    guessMs += diffMs;
  }

  const resolvedDate = new Date(guessMs);
  const resolvedParts = getTimeZoneParts(resolvedDate, timeZone);
  if (
    resolvedParts.year !== desired.year ||
    resolvedParts.month !== desired.month ||
    resolvedParts.day !== desired.day ||
    resolvedParts.hour !== desired.hour ||
    resolvedParts.minute !== desired.minute
  ) {
    throw new Error(
      "That local date and time does not map cleanly in the requested time zone. Try a different time."
    );
  }

  return resolvedDate;
}

function buildDateButtonToken(entryDate) {
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

  return `${weekday} ${parsed.getUTCDate()}`;
}

function buildColumnHeaderLabel(entryDate) {
  const parsed = parseIsoDate(entryDate);
  if (!parsed) {
    throw new Error(`Invalid entry date: ${entryDate}`);
  }

  return parsed.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function matchesExpectedUrl(currentUrl, expectedUrl) {
  try {
    const current = new URL(currentUrl);
    const expected = new URL(expectedUrl);

    if (current.origin !== expected.origin || current.pathname !== expected.pathname) {
      return false;
    }

    for (const [key, value] of expected.searchParams.entries()) {
      if (current.searchParams.get(key) !== value) {
        return false;
      }
    }

    return true;
  } catch {
    return currentUrl === expectedUrl;
  }
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
    const answer = await promptRequired(`${question} (YYYY-MM-DD)`);
    if (parseIsoDate(answer)) {
      return answer;
    }
    console.log("Enter the date as YYYY-MM-DD.");
  }
}

async function promptTimeOfDay(question) {
  while (true) {
    const answer = await promptRequired(`${question} (HH:MM, 24-hour time)`);
    if (parseTimeOfDay(answer)) {
      return answer;
    }
    console.log("Enter the time as HH:MM in 24-hour time.");
  }
}

async function promptTimeZone(question, defaultValue = DEFAULT_RUN_TIME_ZONE) {
  while (true) {
    const answer = await promptRequired(
      `${question} (IANA name, for example America/Los_Angeles)`,
      defaultValue
    );
    if (isValidTimeZone(answer)) {
      return answer;
    }
    console.log("Enter a valid IANA time zone such as America/Los_Angeles.");
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
  let escapeBuffer = "";

  return await new Promise((resolve, reject) => {
    function cleanup() {
      input.removeListener("data", onData);
      input.setRawMode(false);
      output.write("\n");
    }

    function readPlainText(chunk) {
      escapeBuffer += String(chunk);
      let plainText = "";

      while (escapeBuffer.length > 0) {
        if (escapeBuffer[0] !== "\u001b") {
          plainText += escapeBuffer[0];
          escapeBuffer = escapeBuffer.slice(1);
          continue;
        }

        const ansiMatch = escapeBuffer.match(/^\u001b\[[0-9;?]*[ -/]*[@-~]/);
        if (ansiMatch) {
          escapeBuffer = escapeBuffer.slice(ansiMatch[0].length);
          continue;
        }

        break;
      }

      return plainText;
    }

    function onData(chunk) {
      const plainText = readPlainText(chunk);

      for (const char of plainText) {
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

        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            output.write("\b \b");
          }
          continue;
        }

        value += char;
        output.write("*");
      }
    }

    input.on("data", onData);
  });
}

async function promptChoice(question, options, defaultValue) {
  const normalizedOptions = new Map(
    options.map((option) => [option.toLowerCase(), option])
  );
  const promptText = `${question} (${options.join("/")})`;

  while (true) {
    const answer = normalizeText(
      await prompt(promptText, defaultValue ?? options[0])
    );
    const selected = normalizedOptions.get(answer.toLowerCase());
    if (selected) {
      return selected;
    }
    console.log(`Choose one of: ${options.join(", ")}.`);
  }
}

function parseTrailheadPriorities(value) {
  return value
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function stripTrailheadSuffixes(value, destination) {
  let cleaned = normalizeText(value);
  for (const suffix of destination?.trailheadNameSuffixes ?? []) {
    cleaned = cleaned.replace(
      new RegExp(`\\s+${escapeRegex(suffix)}$`, "i"),
      ""
    );
  }
  return normalizeText(cleaned);
}

function normalizeTrailheadName(value, destination) {
  return stripTrailheadSuffixes(value, destination).toLowerCase();
}

function formatTrailheads(trailheads) {
  return trailheads.map((trailhead) => trailhead.name).join(", ");
}

function maskSecret(value) {
  if (!value) {
    return "(blank)";
  }
  return "*".repeat(Math.max(value.length, 8));
}

async function getTrailheadDisplayName(row, destination) {
  const nameButton = row.locator("button[aria-label]:not(.rec-availability-date)");
  const nameButtonCount = await nameButton.count().catch(() => 0);
  if (nameButtonCount === 1) {
    const ariaLabel = normalizeText(
      (await nameButton.getAttribute("aria-label", { timeoutMs: 5000 }).catch(() => "")) ?? ""
    );
    if (ariaLabel) {
      return ariaLabel;
    }

    const buttonText = normalizeText(
      await nameButton.innerText({ timeoutMs: 5000 }).catch(() => "")
    );
    if (buttonText) {
      return buttonText;
    }
  }

  const cells = row.locator('[role="gridcell"]');
  const cellCount = await cells.count().catch(() => 0);
  for (let index = 0; index < cellCount; index += 1) {
    const cellText = normalizeText(
      await cells.nth(index).innerText({ timeoutMs: 5000 }).catch(() => "")
    );
    const strippedCellText = stripTrailheadSuffixes(cellText, destination);
    if (!strippedCellText || /^\d+$/.test(strippedCellText)) {
      continue;
    }
    return strippedCellText;
  }

  return "";
}

async function promptDestination() {
  const choice = await promptChoice(
    "Where do you want to go?",
    ["Yosemite", "Inyo"],
    "Yosemite"
  );

  return FACILITIES[choice.toLowerCase()];
}

async function promptTrailheads() {
  while (true) {
    try {
      const rawPriorities = await promptRequired(
        "Entry point names in priority order (comma-separated)"
      );
      const priorities = parseTrailheadPriorities(rawPriorities);

      if (priorities.length === 0) {
        console.log("Enter at least one entry point name.");
        continue;
      }

      return priorities.map((name) => ({ name }));
    } catch (error) {
      console.log(error.message);
    }
  }
}

function buildRequestReviewItems(request) {
  return [
    {
      label: "Destination",
      display: () => request.destination.label,
      edit: async () => {
        request.destination = await promptDestination();
      },
    },
    {
      label: "Recreation.gov login email",
      display: () => request.account.email,
      edit: async () => {
        request.account.email = await promptRequired("Recreation.gov login email");
      },
    },
    {
      label: "Recreation.gov password",
      display: () => maskSecret(request.account.password),
      edit: async () => {
        request.account.password = await promptRequiredSecret(
          "Recreation.gov password"
        );
      },
    },
    {
      label: "Number of people on the permit",
      display: () => String(request.groupSize),
      edit: async () => {
        request.groupSize = await promptPositiveInteger(
          "Number of people on the permit"
        );
      },
    },
    {
      label: "Entry date",
      display: () => request.entryDate,
      edit: async () => {
        request.entryDate = await promptDate("Entry date");
      },
    },
    {
      label: "Entry point names in priority order",
      display: () => formatTrailheads(request.trailheads),
      edit: async () => {
        request.trailheads = await promptTrailheads();
      },
    },
    {
      label: "Permit holder first name",
      display: () => request.permitHolder.firstName,
      edit: async () => {
        request.permitHolder.firstName = await promptRequired(
          "Permit holder first name"
        );
      },
    },
    {
      label: "Permit holder last name",
      display: () => request.permitHolder.lastName,
      edit: async () => {
        request.permitHolder.lastName = await promptRequired(
          "Permit holder last name"
        );
      },
    },
    {
      label: "Permit holder email",
      display: () => request.permitHolder.email,
      edit: async () => {
        request.permitHolder.email = await promptRequired("Permit holder email");
      },
    },
    {
      label: "Permit holder phone number",
      display: () => request.permitHolder.phone,
      edit: async () => {
        request.permitHolder.phone = await promptRequired(
          "Permit holder phone number"
        );
      },
    },
    {
      label: "Permit holder address",
      display: () => request.permitHolder.address,
      edit: async () => {
        request.permitHolder.address = await promptRequired(
          "Permit holder address"
        );
      },
    },
  ];
}

async function reviewPermitRequest(request) {
  while (true) {
    const reviewItems = buildRequestReviewItems(request);

    console.log("");
    console.log("Review the information below before the browser opens:");
    console.log("");

    for (const [index, item] of reviewItems.entries()) {
      console.log(`${index + 1}) ${item.label}: ${item.display()}`);
    }

    console.log("");
    const answer = await prompt(
      "Enter the number of an item to correct, or press Return to continue"
    );

    if (!answer) {
      return;
    }

    const selectedIndex = Number.parseInt(answer, 10);
    if (
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 1 ||
      selectedIndex > reviewItems.length
    ) {
      console.log("Enter one of the listed numbers, or press Return to continue.");
      continue;
    }

    console.log("");
    await reviewItems[selectedIndex - 1].edit();
  }
}

async function promptRunPlan() {
  const runChoice = await promptChoice(
    "Run the script now or wait until a later time?",
    ["now", "later"],
    "now"
  );

  if (runChoice === "now") {
    return {
      mode: "now",
    };
  }

  while (true) {
    try {
      const runDate = await promptDate("Run date");
      const runTime = await promptTimeOfDay("Run time");
      const timeZone = await promptTimeZone("Run time zone");
      const runAt = zonedDateTimeToDate(runDate, runTime, timeZone);

      if (runAt.getTime() <= Date.now()) {
        console.log("Enter a future date and time.");
        continue;
      }

      console.log("");
      console.log(
        `Scheduled start: ${formatInstantInTimeZone(runAt, timeZone)} (${timeZone})`
      );

      return {
        mode: "later",
        runAtIso: runAt.toISOString(),
        timeZone,
      };
    } catch (error) {
      console.log(error.message);
    }
  }
}

async function collectPermitRequest() {
  console.log("");
  console.log("Backpacking permit reservation intake");
  console.log("");

  const destination = await promptDestination();
  const accountEmail = await promptRequired(
    "Recreation.gov login email",
    process.env.RECREATION_GOV_USERNAME ?? ""
  );
  let accountPassword =
    process.env.RECREATION_GOV_PASSWORD && normalizeText(process.env.RECREATION_GOV_PASSWORD)
      ? normalizeText(process.env.RECREATION_GOV_PASSWORD)
      : "";

  while (!accountPassword) {
    accountPassword = await promptRequiredSecret("Recreation.gov password");
  }

  const groupSize = await promptPositiveInteger("Number of people on the permit");
  const entryDate = await promptDate("Entry date");
  const trailheads = await promptTrailheads();

  const permitHolder = {
    firstName: await promptRequired("Permit holder first name"),
    lastName: await promptRequired("Permit holder last name"),
    email: await promptRequired("Permit holder email"),
    phone: await promptRequired("Permit holder phone number"),
    address: await promptRequired("Permit holder address"),
  };

  const request = {
    destination,
    account: {
      email: accountEmail,
      password: accountPassword,
    },
    groupSize,
    entryDate,
    trailheads,
    permitHolder,
  };

  await reviewPermitRequest(request);
  request.runPlan = await promptRunPlan();
  return request;
}

async function waitForRunPlan(runPlan) {
  if (!runPlan || runPlan.mode !== "later") {
    return;
  }

  const target = new Date(runPlan.runAtIso);
  console.log("");
  console.log(
    `Waiting until ${formatInstantInTimeZone(target, runPlan.timeZone)} (${runPlan.timeZone}) to begin...`
  );

  while (true) {
    const remainingMs = target.getTime() - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    let delayMs = remainingMs;
    if (remainingMs > 60 * 60 * 1000) {
      delayMs = Math.min(remainingMs, 15 * 60 * 1000);
    } else if (remainingMs > 5 * 60 * 1000) {
      delayMs = Math.min(remainingMs, 60 * 1000);
    } else if (remainingMs > 10 * 1000) {
      delayMs = Math.min(remainingMs, 5 * 1000);
    } else {
      delayMs = Math.min(remainingMs, 250);
    }

    await sleep(delayMs);
  }

  console.log("");
  console.log(
    `Starting now at ${formatInstantInTimeZone(new Date(), runPlan.timeZone)} (${runPlan.timeZone}).`
  );
}

async function isVisible(locator) {
  return await locator.isVisible().catch(() => false);
}

function getFieldResolutionCache(page) {
  const currentUrl = page.url();
  const cached = FIELD_RESOLUTION_CACHE.get(page);

  if (cached && cached.url === currentUrl) {
    return cached;
  }

  const next = {
    url: currentUrl,
    controlInventory: null,
    locators: new Map(),
  };
  FIELD_RESOLUTION_CACHE.set(page, next);
  return next;
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
  const cache = getFieldResolutionCache(page);
  if (cache.controlInventory) {
    return cache.controlInventory;
  }

  cache.controlInventory = await page.evaluate(() => {
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

  return cache.controlInventory;
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
  const cache = getFieldResolutionCache(page);
  const cachedLocator = cache.locators.get(fieldKey);

  if (cachedLocator) {
    const count = await cachedLocator.count().catch(() => 0);
    if (count > 0) {
      return cachedLocator;
    }

    cache.locators.delete(fieldKey);
  }

  const direct = await findDirectLocator(page, config);
  if (direct) {
    cache.locators.set(fieldKey, direct);
    return direct;
  }

  const fuzzy = await findFuzzyLocator(page, config);
  if (fuzzy) {
    cache.locators.set(fieldKey, fuzzy);
  }

  return fuzzy;
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

async function promptRequiredSecret(question) {
  while (true) {
    const answer = normalizeText(await promptSecret(question));
    if (answer) {
      return answer;
    }
    console.log("A value is required.");
  }
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

  const optionCandidates = [
    page.getByRole("option", { name: value, exact: true }),
    page.getByRole("radio", { name: value, exact: true }),
    page.getByText(value, { exact: true }),
  ];

  const selectedOption = await waitForCondition(
    async () => await findVisibleLocator(optionCandidates),
    { timeoutMs: 2000, intervalMs: 50 }
  );
  if (selectedOption) {
    await selectedOption.click();
    return;
  }

  throw new Error(
    `Found the ${FIELD_CONFIG[fieldKey].description} control, but could not choose "${value}".`
  );
}

async function applyChoiceField(page, fieldKey, value, required) {
  if (!value) {
    return;
  }

  try {
    await selectChoiceField(page, fieldKey, value);
  } catch (error) {
    if (required) {
      throw error;
    }

    console.log(`Skipping ${FIELD_CONFIG[fieldKey].description}: ${error.message}`);
  }
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

async function firstVisibleLocator(locator) {
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await isVisible(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function findVisibleLocator(candidates) {
  for (const candidate of candidates) {
    const visibleCandidate = await firstVisibleLocator(candidate);
    if (visibleCandidate) {
      return visibleCandidate;
    }
  }

  return null;
}

async function getVisibleLoginForm(page) {
  const loginDialog = page.getByRole("dialog", {
    name: "Log In to Recreation.gov",
    exact: false,
  });
  const root =
    (await isVisible(loginDialog))
      ? loginDialog
      : page;

  const emailField = await findVisibleLocator([
    root.getByLabel("Email (Required)", { exact: true }),
    root.getByRole("textbox", { name: "Email (Required)", exact: true }),
    root.locator('input[type="email"]'),
    root.locator('input[name*="email" i]'),
  ]);
  const passwordField = await findVisibleLocator([
    root.getByLabel("Password (Required)", { exact: true }),
    root.locator('input[type="password"]'),
  ]);

  if (!emailField || !passwordField) {
    return null;
  }

  const submitButton = await findVisibleLocator([
    root.getByRole("button", { name: "Log In", exact: true }),
    root.getByRole("button", { name: "Log In", exact: false }),
    root.getByRole("button", { name: "Sign In", exact: false }),
    root.locator('button[type="submit"]'),
    root.locator('input[type="submit"]'),
  ]);

  if (!submitButton) {
    return null;
  }

  return {
    root,
    emailField,
    passwordField,
    submitButton,
  };
}

async function ensureAvailabilityPage(page, request) {
  const availabilityUrl = request.destination.buildAvailabilityUrl(request.entryDate);
  if (matchesExpectedUrl(page.url(), availabilityUrl)) {
    return;
  }

  console.log("Opening the availability grid...");
  await page.goto(availabilityUrl, { waitUntil: "domcontentloaded" });
}

async function submitLoginIfVisible(page, account, reason = "Signing into Recreation.gov...") {
  const loginForm = await getVisibleLoginForm(page);
  if (!loginForm) {
    return false;
  }

  console.log(reason);
  await loginForm.emailField.fill(account.email);
  await loginForm.passwordField.fill(account.password);
  await loginForm.submitButton.click();

  const dismissed = await waitForCondition(
    async () => !(await getVisibleLoginForm(page)),
    { timeoutMs: 20000, intervalMs: 100 }
  );
  if (dismissed) {
    return true;
  }

  console.log("");
  console.log("Additional sign-in verification appears to be required.");
  console.log("Complete any sign-in challenge in the opened browser window, then continue here.");
  await promptEnter("Press Enter once Recreation.gov shows you as signed in");
  return true;
}

async function ensureSignedIn(page, request) {
  await ensureAvailabilityPage(page, request);
  await page.bringToFront().catch(() => {});

  const loginButton = page.getByRole("button", {
    name: "Sign Up or Log In",
    exact: true,
  });

  if (!(await isVisible(loginButton))) {
    console.log("Recreation.gov already appears to be signed in.");
    return;
  }

  await loginButton.click();
  const submitted = await submitLoginIfVisible(page, request.account);
  if (!submitted) {
    throw new Error("The Recreation.gov login form did not appear after clicking Log In.");
  }

  await ensureAvailabilityPage(page, request);
}

async function setRadioChoice(page, label) {
  const radio = page.getByRole("radio", {
    name: label,
    exact: true,
  });
  const count = await radio.count().catch(() => 0);
  if (count !== 1) {
    throw new Error(`Unable to find the "${label}" radio option.`);
  }

  await radio.click();
}

async function selectVisibleNativeOption(page, selectors, label, description) {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);

    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }

      await candidate.selectOption({ label });
      return;
    }
  }

  throw new Error(`Unable to find the ${description} control.`);
}

async function prepareAvailabilityGrid(page, request) {
  const availabilitySetup = request.destination.availabilitySetup;
  if (availabilitySetup?.commercialGuidedTrip) {
    console.log(
      `Setting commercial guided trip to ${availabilitySetup.commercialGuidedTrip}...`
    );
    await setRadioChoice(page, availabilitySetup.commercialGuidedTrip);
  }

  if (availabilitySetup?.permitType) {
    console.log(`Setting permit type to ${availabilitySetup.permitType}...`);
    await selectVisibleNativeOption(
      page,
      ["select#permit-type", 'select[name*="permit"]'],
      availabilitySetup.permitType,
      "permit type"
    );
  }
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

  const closed = await waitForCondition(
    async () => !(await isVisible(infoHeading)),
    { timeoutMs: 15000, intervalMs: 100 }
  );
  if (closed) {
    return;
  }
}

async function ensureEntryDate(page, entryDate) {
  const headerLabel = buildColumnHeaderLabel(entryDate);
  const matchingHeader = page.getByRole("columnheader", {
    name: headerLabel,
    exact: false,
  });

  if ((await matchingHeader.count().catch(() => 0)) > 0) {
    return;
  }

  console.log(`Setting entry date to ${entryDate}...`);
  const [year, month, day] = entryDate.split("-");
  const spinbuttons = page.getByRole("spinbutton");
  const spinbuttonCount = await spinbuttons.count().catch(() => 0);

  if (spinbuttonCount < 3) {
    throw new Error("Unable to find the entry date controls.");
  }

  const monthField = spinbuttons.nth(0);
  const dayField = spinbuttons.nth(1);
  const yearField = spinbuttons.nth(2);

  await monthField.fill(String(Number.parseInt(month, 10)));
  await dayField.fill(String(Number.parseInt(day, 10)));
  await yearField.fill(year);
  await yearField.press("Tab").catch(() => {});

  const updated = await waitForCondition(
    async () => (await matchingHeader.count().catch(() => 0)) > 0,
    { timeoutMs: 15000, intervalMs: 100 }
  );
  if (updated) {
    return;
  }

  throw new Error(`The availability grid did not update to show ${headerLabel}.`);
}

async function getTrailheadRowInventory(page, destination) {
  const rows = page.locator('[role="row"]');
  const rowCount = await rows.count().catch(() => 0);
  const inventory = [];

  for (let index = 0; index < rowCount; index += 1) {
    const row = rows.nth(index);
    const cells = row.locator('[role="gridcell"]');
    const cellCount = await cells.count().catch(() => 0);
    if (cellCount === 0) {
      continue;
    }

    const displayName = await getTrailheadDisplayName(row, destination);
    const normalizedName = normalizeTrailheadName(displayName, destination);

    if (!normalizedName) {
      continue;
    }

    inventory.push({
      displayName,
      normalizedName,
      row,
    });
  }

  return inventory;
}

function findTrailheadRow(entryPointName, inventory, destination) {
  const normalizedInput = normalizeTrailheadName(entryPointName, destination);
  if (!normalizedInput) {
    return null;
  }

  const exactMatches = inventory.filter((entry) => entry.normalizedName === normalizedInput);
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  const fuzzyMatches = inventory.filter((entry) =>
    entry.normalizedName.includes(normalizedInput) || normalizedInput.includes(entry.normalizedName)
  );

  return fuzzyMatches.length === 1 ? fuzzyMatches[0] : null;
}

async function selectTrailheadByPriority(page, request) {
  await ensureAvailabilityPage(page, request);
  await prepareAvailabilityGrid(page, request);
  await ensureEntryDate(page, request.entryDate);
  await setGroupSize(page, request.groupSize);
  await ensureEntryDate(page, request.entryDate);

  const trailheadInventory = await getTrailheadRowInventory(
    page,
    request.destination
  );
  const dateToken = buildDateButtonToken(request.entryDate);
  const bookNowButton = page.getByRole("button", {
    name: "Book Now",
    exact: true,
  });
  let matchedAtLeastOneTrailhead = false;

  for (const trailhead of request.trailheads) {
    console.log(`Checking entry point ${trailhead.name}...`);
    const matchedTrailhead = findTrailheadRow(
      trailhead.name,
      trailheadInventory,
      request.destination
    );
    if (!matchedTrailhead) {
      console.log(`Entry point ${trailhead.name} was not present in the current table view.`);
      continue;
    }
    matchedAtLeastOneTrailhead = true;

    const row = matchedTrailhead.row;
    const availabilityButton = row.getByRole("button", {
      name: dateToken,
      exact: false,
    });
    const buttonCount = await availabilityButton.count().catch(() => 0);
    if (buttonCount !== 1) {
      console.log(`Entry point ${trailhead.name} does not expose a selectable cell for ${request.entryDate}.`);
      continue;
    }

    if (!(await availabilityButton.isEnabled().catch(() => false))) {
      console.log(`Entry point ${trailhead.name} is visible but not bookable for ${request.entryDate}.`);
      continue;
    }

    await availabilityButton.click();

    const enabled = await waitForCondition(
      async () => await bookNowButton.isEnabled().catch(() => false),
      { timeoutMs: 5000, intervalMs: 100 }
    );
    if (enabled) {
      console.log(`Selected entry point ${matchedTrailhead.displayName}.`);
      return {
        ...trailhead,
        displayName: matchedTrailhead.displayName,
      };
    }

    const clearDatesButton = page.getByRole("button", {
      name: "Clear Dates that were selected",
      exact: true,
    });

    if (await isVisible(clearDatesButton)) {
      await clearDatesButton.click().catch(() => {});
      await waitForCondition(
        async () => !(await bookNowButton.isEnabled().catch(() => false)),
        { timeoutMs: 1500, intervalMs: 100 }
      );
    }
  }

  if (!matchedAtLeastOneTrailhead) {
    throw new Error(
      "None of the requested entry points could be matched on Recreation.gov. Enter the visible entry point names from the availability grid."
    );
  }

  throw new Error(
    `None of the requested entry points had availability on ${request.entryDate}.`
  );
}

async function waitForReservationForm(page, account) {
  const detectionFields = [
    "travelMethod",
    "issuingStation",
  ];

  const formVisible = await waitForCondition(async () => {
    for (const fieldKey of detectionFields) {
      const locator = await resolveFieldLocator(page, fieldKey);
      if (locator && (await isVisible(locator))) {
        return true;
      }
    }

    const loginSubmitted = await submitLoginIfVisible(
      page,
      account,
      "Recreation.gov requested sign-in before opening permit details. Submitting credentials..."
    );
    if (loginSubmitted) {
      return false;
    }

    return false;
  }, { timeoutMs: 30000, intervalMs: 250 });
  if (formVisible) {
    return;
  }

  console.log("");
  console.log("The reservation-details form did not appear automatically.");
  console.log("If Recreation.gov opened an intermediate screen, advance to the permit details form in the browser window now.");
  await promptEnter("Press Enter once the permit details form is visible");
}

async function continueToDetailsPage(page, account) {
  const bookNowButton = page.getByRole("button", {
    name: "Book Now",
    exact: true,
  });

  if (!(await bookNowButton.isEnabled().catch(() => false))) {
    throw new Error("Book Now is not enabled after selecting an entry point.");
  }

  console.log("Opening the reservation details screen...");
  await bookNowButton.click();
  await waitForReservationForm(page, account);
}

async function fillReservationForm(page, request) {
  console.log("Filling the reservation form...");
  const fixedDetails = request.destination.fixedDetails;

  await fillTextLikeField(page, "permitHolderFirstName", request.permitHolder.firstName);
  await fillTextLikeField(page, "permitHolderLastName", request.permitHolder.lastName);
  await fillTextLikeField(page, "permitHolderEmail", request.permitHolder.email);
  await fillTextLikeField(page, "permitHolderPhone", request.permitHolder.phone);
  await fillTextLikeField(page, "permitHolderAddress", request.permitHolder.address);

  await applyChoiceField(
    page,
    "travelMethod",
    fixedDetails.travelMethod?.value,
    fixedDetails.travelMethod?.required ?? true
  );
  await applyChoiceField(
    page,
    "animals",
    fixedDetails.animals?.value,
    fixedDetails.animals?.required ?? true
  );
  await applyChoiceField(
    page,
    "issuingStation",
    fixedDetails.issuingStation?.value,
    fixedDetails.issuingStation?.required ?? true
  );
  await applyChoiceField(
    page,
    "lateArrival",
    fixedDetails.lateArrival?.value,
    fixedDetails.lateArrival?.required ?? true
  );
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

function logWebsiteInteractionTiming(timing) {
  if (!timing.has("websiteStart")) {
    return;
  }

  console.log("");
  console.log("Website interaction timing:");
  console.log(
    `- Total to handoff: ${formatDuration(
      timing.durationMs("websiteStart", "handoffReady")
    )}`
  );
  console.log(
    `- Sign in and reach availability grid: ${formatDuration(
      timing.durationMs("websiteStart", "signedIn")
    )}`
  );
  console.log(
    `- Select trailhead: ${formatDuration(
      timing.durationMs("signedIn", "trailheadSelected")
    )}`
  );
  console.log(
    `- Open reservation form: ${formatDuration(
      timing.durationMs("trailheadSelected", "detailsReady")
    )}`
  );
  console.log(
    `- Fill form and prepare handoff: ${formatDuration(
      timing.durationMs("detailsReady", "handoffReady")
    )}`
  );
}

export async function main() {
  const timing = createTimingTracker();
  const request = await collectPermitRequest();
  await waitForRunPlan(request.runPlan);
  const context = await launchBrowser();
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(20000);

  try {
    timing.mark("websiteStart");
    await ensureSignedIn(page, request);
    timing.mark("signedIn");
    const selectedTrailhead = await selectTrailheadByPriority(page, request);
    timing.mark("trailheadSelected");
    await continueToDetailsPage(page, request.account);
    timing.mark("detailsReady");
    await fillReservationForm(page, request);
    await page.bringToFront().catch(() => {});

    const handoffUrl = page.url();
    await writeHandoffUrl(handoffUrl);
    timing.mark("handoffReady");

    console.log("");
    console.log(`Selected entry point: ${selectedTrailhead.displayName ?? selectedTrailhead.name}`);
    console.log(`Handoff URL: ${handoffUrl}`);
    console.log(`Saved handoff URL to ${HANDOFF_FILE}`);
    logWebsiteInteractionTiming(timing);
    await holdForHandoff();
  } catch (error) {
    const diagnostics = await captureDiagnostics(page, "permit-reservation-error");
    const currentUrl = page.url();
    await page.bringToFront().catch(() => {});
    console.error("");
    console.error(error.message);
    console.error(`Current browser URL: ${currentUrl}`);
    console.error(`Saved diagnostics to ${diagnostics.pngPath} and ${diagnostics.htmlPath}`);
    if (timing.has("websiteStart")) {
      console.error(
        `Website interaction elapsed before error: ${formatDuration(
          timing.elapsedSince("websiteStart")
        )}`
      );
    }
    await holdForHandoff();
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
