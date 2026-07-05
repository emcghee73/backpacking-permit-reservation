# Backpacking Permit Reservation

This project is a Playwright-based CLI for preparing a Yosemite wilderness permit reservation on Recreation.gov and stopping at a live browser handoff point so you can finish the booking manually.

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

- Recreation.gov login email and password
- Group size
- Entry date
- Trailhead IDs in priority order
- First-night camp text for each trailhead
- Exit point
- Exit date
- Permit-holder first name
- Permit-holder last name
- Permit-holder email
- Permit-holder phone number
- Permit-holder address
- Emergency-contact first name
- Emergency-contact last name
- Emergency-contact phone number

## What It Automates

- Signs into Recreation.gov
- Opens the Yosemite wilderness permit availability grid
- Sets the requested group size
- Tries trailhead IDs in priority order for the requested entry date
- Selects the first available trailhead
- Fills the reservation details form with your supplied information
- Applies the fixed values:
  - `Travel Method = Foot`
  - `Animals = No`
  - `Issuing Station = Tuolumne Meadows Wilderness Center`
  - `Late Arrival = Yes`
- Checks the `Need to Know` agreement when the site exposes a matching control
- Leaves the browser open and prints the current handoff URL

## Files Created By The Program

- The program stores its runtime files under the current directory in `.backpacking-permit-reservation/`.
- If you launch it from `/Users/ericmcghee/Documents/fancypants`, it will use `/Users/ericmcghee/Documents/fancypants/.backpacking-permit-reservation/`.
- The browser profile is stored in `.backpacking-permit-reservation/browser-profile/`.
- The handoff URL is saved in `.backpacking-permit-reservation/handoff-url.txt`.
- Troubleshooting screenshots and page HTML are saved in `.backpacking-permit-reservation/diagnostics/` if something goes wrong.

## Important Notes

- The reliable handoff is the still-open browser window; the printed URL is only a convenience.
- If Recreation.gov asks for extra sign-in verification, complete it in the opened browser window and then continue in Terminal.
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
