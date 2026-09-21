# Backpacking Permit Reservation

This project is a Playwright-based CLI for preparing a Yosemite or Inyo wilderness permit reservation on Recreation.gov and stopping at a live browser handoff point so you can finish the booking manually.

## Requirements

- Node.js 18 or newer
- `npm`
- A desktop session that can open a visible browser window
- A Recreation.gov account

## Get The Code

```bash
git clone https://github.com/emcghee73/backpacking-permit-reservation.git
cd backpacking-permit-reservation
```

If you downloaded the repository as a ZIP instead, open Terminal and `cd` into the extracted folder before continuing.

## Install Dependencies

```bash
npm install
```

If Playwright's browser download was skipped or failed, run:

```bash
npx playwright install chromium
```

## Run From The Repository Folder

From the repository folder:

```bash
npm run permit:reserve
```

You can also use:

```bash
npm start
```

## Run From Any Folder On Your Computer

If you want the tool to use whatever folder you are currently in, link the CLI once from the repository:

```bash
cd "/path/to/backpacking-permit-reservation"
npm link
```

After that, you can move to any folder and launch it there:

```bash
cd "/Users/ericmcghee/Documents/fancypants"
permit-reserve
```

When you run it this way, the program stores its working files in the folder you launched it from.

## What The Program Prompts For

- Destination: `Yosemite` or `Inyo`
- Recreation.gov login email and password
- Group size
- Entry date in `YYYY-MM-DD` format
- Entry point names in priority order
- Permit-holder first name
- Permit-holder last name
- Permit-holder email
- Permit-holder phone number
- Permit-holder address
- A numbered review screen so you can correct any single item before the browser opens
- A final choice to run immediately or wait until a later date, time, and time zone

## What It Automates

- Signs into Recreation.gov
- Opens the correct Recreation.gov permit flow for Yosemite or Inyo
- For Inyo, selects `No` for the commercial-guided-trip question and `Overnight` for permit type before using the availability grid
- Sets the requested group size
- Tries your entry point priorities in order for the requested entry date
- Selects the first available entry point
- If Recreation.gov asks for sign-in again after `Book Now`, submits the same login credentials automatically
- Fills the reservation details form with your supplied permit-holder information
- For Yosemite, applies the fixed values:
  - `Travel Method = Foot`
  - `Animals = No`
  - `Issuing Station = Tuolumne Meadows Wilderness Center`
  - `Late Arrival = Yes`
- For Inyo, attempts the same fixed values when matching controls are present on the reservation form
- Checks the `Need to Know` agreement when the site exposes a matching control
- If you choose a later run time, waits inside the CLI until 90 seconds before the requested date, time, and time zone, then opens the browser and signs in ahead of time
- At the scheduled moment it reloads the availability grid so the data is fresh, then continues straight to entry point selection
- Leaves the browser open and prints the current handoff URL
- Prints a timing breakdown for the website-interaction portion of the run, from the first Recreation.gov page load to handoff, including the time from the start of website entry to the moment a trailhead is selected
- For scheduled runs, if none of the requested entry points show availability yet, refreshes the grid every second or so for up to two minutes, because the availability grid does not update on its own

## Files Created By The Program

- The program stores its runtime files under the current directory in `.backpacking-permit-reservation/`.
- If you launch it from `/Users/ericmcghee/Documents/fancypants`, it will use `/Users/ericmcghee/Documents/fancypants/.backpacking-permit-reservation/`.
- The browser profile is stored in `.backpacking-permit-reservation/browser-profile/`.
- The handoff URL is saved in `.backpacking-permit-reservation/handoff-url.txt`.
- Troubleshooting screenshots and page HTML are saved in `.backpacking-permit-reservation/diagnostics/` if something goes wrong.

## Important Notes

- The reliable handoff is the still-open browser window in the same logged-in session; the printed URL is only a convenience.
- The timing summary shown at the end measures only the website-interaction portion of the run. It does not include the time you spend answering prompts before the browser starts.
- For a scheduled run, the early browser warm-up and sign-in are reported on their own line and are not counted in the total to handoff.
- The availability grid only fetches data when the page loads or the date changes; it does not refresh itself. A scheduled run reloads the grid at the scheduled moment and, if the requested entry points are not yet released, keeps reloading for up to two minutes. Schedule the run for the release time itself, not earlier.
- Use the visible entry point names from the Recreation.gov availability grid when entering your priorities.
- The program shows a numbered review of everything you entered and lets you correct one item at a time before the browser opens.
- For scheduled runs, the time-zone prompt now defaults to `America/Los_Angeles`.
- If you schedule a later run, keep the Terminal session open so the CLI can keep waiting and then start on time.
- For a scheduled run the browser opens and signs in about 90 seconds early. If Recreation.gov asks for extra sign-in verification at that point, complete it in the browser and press Enter in Terminal before the scheduled time.
- If you schedule a later run, the computer itself must stay awake. A sleeping Mac will pause the wait timer. The display can turn off, but the machine cannot sleep or close its lid.
- On a Mac, one simple way to keep it awake during a scheduled run is:

```bash
caffeinate -i npm run permit:reserve
```

- The script does not fill the intended first-night camp location, exit point, or exit date. You can enter those manually after handoff.
- The script also does not prompt for or fill the emergency contact name and phone number. You can enter those manually after handoff.
- If Recreation.gov asks for extra sign-in verification, complete it in the opened browser window and then continue in Terminal.
- If the automation hits an error, it still keeps the browser open so you can inspect the page or take over manually before closing it.
- If Recreation.gov changes its labels or form structure, the script writes troubleshooting diagnostics into the current-directory runtime folder.

## Troubleshooting

If you see an error like:

```text
npm error enoent Could not read package.json
```

that usually means you ran `npm install` or `npm run permit:reserve` from the wrong folder.

Move into the repository folder first:

```bash
cd "/path/to/backpacking-permit-reservation"
npm install
npm run permit:reserve
```

If you want to run it from some other folder, use `npm link` once from the repository folder, then run:

```bash
cd "/your/working/folder"
permit-reserve
```
