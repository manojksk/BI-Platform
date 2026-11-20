# Upgrading Salon Manager (Without Losing Your Data)

## Short answer

Yes — extract the new files directly into the same folder you've already
been running, overwriting the old ones. Your actual data (customers, bills,
staff, logins — everything) lives in a separate `data` subfolder that these
code files never touch, so replacing them is safe.

## Step by step

### 1. Stop the server
Close the black server window (or press Ctrl+C in it). Make sure it's
fully stopped before touching any files.

### 2. Back up first, just in case (30 seconds, recommended)
Copy the whole `data` folder — the one sitting next to `server.py` — to
your Desktop or a USB drive. This is a safety net, not a requirement: the
app already writes a dated backup into `data/backups/` automatically, but
having your own copy before any upgrade is good practice.

### 3. Extract the new zip somewhere temporary
Don't unzip it directly on top of your live folder. Extract it to a new,
separate location first (e.g. a temporary folder on your Desktop) so you
can pick and choose what to copy.

### 4. Copy the new files into your existing live folder
From that temporary extracted folder, copy these into your existing folder,
replacing the old versions when Windows/Mac asks:

- `server.py`
- `salon-manager-remote.html`
- `app-remote.jsx`
- `README.md`
- `INSTRUCTIONS.md`
- `check-prerequisites-windows.bat`, `check-prerequisites-windows.ps1`
- `check-prerequisites-mac-linux.sh`
- `install-python-windows.bat`, `install-python-windows.ps1`
- `install-python-mac-linux.sh`
- `start-server-windows.bat`
- `start-server-mac-linux.sh`

### 5. Leave the `data` folder exactly where it is
Do not copy anything into it, delete it, or replace it. It isn't part of
the zip at all — as long as you don't touch it, your database and backups
stay exactly as they were.

### 6. Start the server again
Double-click `start-server-windows.bat` (or run the `.sh` on Mac/Linux) like
always.

### 7. Confirm it worked
Open the app in Chrome. You should land on the **Log In** screen — not
"Set Up This Salon." Seeing "Log In" is the confirmation that your existing
accounts were recognized. Log in and check that your customers, staff, and
bills are all still there.

New sections (Appointments, the redesigned Enquiries fields, the new
Reports tabs) will just appear — nothing extra to set up for those; the
app creates what it needs the first time the new code runs.

## What carries over perfectly

- Every customer, staff member, service, bill, membership plan, offer code,
  and outreach log entry
- Every login you've created (owner and any team members)
- All backups already taken

## A couple of small things about older records

- **Enquiries created before this update** used a slightly different set of
  fields. They'll still show up fine, but the newer fields (Location,
  Follow-up Date, Source) will be blank on those older entries until you
  open and fill them in.
- **Bills created before this update** won't have an automatic Invoice
  Number — that feature is new, so older bills show "—" in that column.
  Every bill from now on gets one automatically.
- **Staff Monthly Target** is a new field — if you haven't set it for each
  staff member yet (Staff → Edit), the new Service Provider report will show
  "No target" instead of an achieved percentage until you do.

Nothing here causes data loss — these are just fields that didn't exist on
older records, so they show as blank until you fill them in going forward.

## If anything looks wrong afterward

You have two safety nets: the backup copy you made in Step 2, and the
automatic dated backups already sitting in `data/backups/`. Worst case,
you can restore from either — nothing is deleted by this process.
