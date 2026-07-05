# Backpacking Permit Reservation

This project is a Playwright-based CLI for preparing a Yosemite wilderness permit reservation on Recreation.gov and stopping at a live browser handoff point so you can finish the booking manually.

## Install

```bash
npm install
```

## Run

```bash
npm run permit:reserve
```

The script prompts for:

- Recreation.gov login email and password
- Group size
- Entry date
- Trailhead IDs in priority order
- First-night camp text for each trailhead
- Exit point and exit date
- Permit-holder name and contact details
- Emergency-contact details

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

## Notes

- Browser profile data is stored under `data/`, which is git-ignored.
- The reliable handoff is the still-open browser window; the printed URL is only a convenience.
- If Recreation.gov changes its labels or form structure, the script writes troubleshooting diagnostics to a temp directory.
