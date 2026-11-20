# Salon Manager — Shared, Multi-Device Setup

## What changed from the single-computer version

You now have three people (you, your wife, your manager) who need to see the
**same** live customer, billing, and staff data — including from phones,
including away from the salon. That needs a different shape than the old
"pick a folder on this one computer" version: one computer now runs a small
server, and every device (including phones) talks to it. Nothing is stored
in any browser, and nothing goes to a third-party cloud — the data still
lives only on hardware you own, in a real database file on the server
computer.

## What's in this folder

| File | Purpose |
|---|---|
| `server.py` | The server. Run this on **one** computer — the one that will always be on, e.g. the reception desk machine. Pure Python standard library, no installs beyond Python itself. |
| `salon-manager-remote.html` | The app frontend. Served automatically by `server.py` — you never open this file directly. |
| `app-remote.jsx` | Readable source code, for reference only. |
| `start-server-windows.bat` / `start-server-mac-linux.sh` | Starts the server. Run on the **server computer** only. |
| `check-prerequisites-windows.*` / `check-prerequisites-mac-linux.sh` | Run first — checks Python, the app files, and whether Tailscale is installed. |
| `install-python-windows.*` / `install-python-mac-linux.sh` | Installs Python automatically if the check says it's missing. |
| `README.md` | This file. |

## Step 1 — Set up the server computer

Pick **one** computer that can stay on and connected during business hours —
this becomes "the server." This is normally the reception desk computer.

1. Copy this whole folder onto that computer.
2. Run the prerequisite checker for its operating system, and install Python
   if it says so (`install-python-*`).
3. Run `start-server-windows.bat` (or `start-server-mac-linux.sh`).
4. On that same computer, open Chrome and go to `http://localhost:8765/` —
   you should see **"Set Up This Salon."** Create your own login there
   (username + password). This is a one-time step.

**Bringing over existing data:** if you already used the earlier
single-computer version of this app, copy its `salon-data.json` file into
this folder (next to `server.py`) *before* starting the server for the first
time. It's imported automatically into the new database on first run.

## Step 2 — Add logins for your wife and your manager

Once you're logged in, go to **Backup → Team Access** and add a username and
password for each of them. Everyone who logs in sees and edits the exact
same data — your manager billing a customer shows up on your phone
immediately, and vice versa.

## New: Enquiries

Track a walk-in or phone enquiry even before it becomes a paid visit —
client name, contact number, location, which service they asked about,
notes (a running text box you can update over time), a follow-up date,
where the enquiry came from (In-Salon, JustDial, Phone, Whatsapp,
Instagram), and a lead status (Pending, Converted, Closed). Find it in the
left menu under **Enquiries**.

## Billing improvements

- **Search customers by phone or name** when creating a bill — type a few
  digits or letters instead of scrolling a long list.
- **Invoice numbers**: every bill now gets an automatic, unique invoice
  number (`INV-00001`, `INV-00002`, ...) shown in the Billing list.
- **Editable line price**: the price next to each service on a bill can be
  changed directly, for on-spot discounts — separate from the overall
  Discount % field.
- **Gender and birthday** can now be filled in right from the quick "+ New"
  customer box inside the billing screen, not just the full Customers form.
- **Payment mode** now offers Cash, Card, **UPI-HDFC**, **UPI-PhonePe**, and
  Other, in place of a single generic "UPI" option.

## New: AI Assistant

Ask plain-English questions about your own data, including multi-part ones —
e.g. *"Show me sale data from the 10th to 12th for Kavya, what premium
services she covered, and how many customers she didn't convert."* The
assistant chains together as many data lookups as a question needs — that
example alone is two separate lookups combined into one answer. Find it
under **Assistant** in the left menu.

It can also give advice, not just facts — e.g. *"What offers should we
focus on?"* or *"How's this month trending vs last month?"* For these, it
pulls real numbers first (a business-performance snapshot, actual offer
redemption rates from your Outreach codes matched against paid bills, age
or staff breakdowns) and clearly labels what's a fact from your data versus
what it's suggesting — it won't give generic marketing advice untethered
from your actual numbers. Treat suggestions as a starting point for your
own judgment, not a decision already made.

**This needs a one-time setup on the server computer**, and it has a real
(small) ongoing cost, since each question is billed by Anthropic:

1. Go to [console.anthropic.com](https://console.anthropic.com), create an
   account if needed, and generate an API key.
2. On the server computer, inside the `data` folder next to `server.py`,
   create a plain text file named exactly `anthropic-api-key.txt`.
3. Paste your key into that file and save it.
4. Restart the server (close the black window, run `start-server-windows.bat`
   again).
5. Open **Assistant** in the app — it should now show a chat box instead of
   a setup message.

The key never leaves the server computer — it's never sent to any phone or
browser. Costs are typically a small fraction of a rupee per question with
the default model, but they are real and appear on your Anthropic account,
not free. A locally-installed/self-hosted model was considered as a way to
cut this cost, but isn't recommended at this scale: the hardware needed for
reliable tool-use is well beyond a typical reception PC, and the API cost
at realistic salon volume is already lower than what that hardware would
cost. Worth revisiting only if usage grows dramatically or this expands
across multiple locations.

## New: Appointments

Book a future visit — Name, Contact Number, WhatsApp Number (a "Same" button
copies the contact number if it's the same), Appointment Date & Time, Gender,
and Source (In-Salon, JustDial, Phone, Whatsapp, Instagram). Find it under
**Appointments**. Each appointment also has a status (Upcoming, Completed,
Cancelled, No-show) so the list can show just what's still coming up.

## New: Staff Monthly Targets

Each staff member (Staff → Edit) now has a **Monthly Target** in ₹. Reports →
**Service Provider** shows, for whatever date range you pick, that target
prorated to the number of days selected, how much was actually achieved, and
the achieved percentage — so a one-week view shows roughly 1/4 of the
monthly number, a custom range shows its own share.

## New: Gemini as an Alternative Assistant Provider

The AI Assistant can now run on Google's Gemini as well as Claude — a
toggle at the top of the Assistant tab switches between them. Both work
identically from your side (same questions, same 9 tools, same
personality); only which company's model answers changes. Claude keeps
working exactly as before — this is purely additive.

**Setup:** get a key at aistudio.google.com, then create
`data/gemini-api-key.txt` next to `server.py` (same pattern as the
existing `anthropic-api-key.txt`) and restart the server. Gemini has a
free usage tier with rate limits — billed (or rate-limited) on your own
Google account, separately from Anthropic.

**Switching providers starts a fresh conversation** — the two use
different underlying formats for chat history, so this is a deliberate
simplification rather than an oversight.

**A build note worth having on record:** this is built against Google's
brand-new Interactions API, which only reached general availability in
the last few months — their own documentation marks the older approach
"legacy" now. Since I had no real Gemini credentials to test against, I
verified this by building a local mock server matching Google's
documented request/response contract and confirming the full tool-calling
round trip against it — request format, response parsing, and the
follow-up request after a tool executes. That's real verification of the
logic, but it's not the same as a live call to Google's servers, so treat
your first real question to it as the actual first live test.

**One genuine bug this caught, worth knowing about:** building that mock
test surfaced a real, pre-existing bug — `urllib.request` was never
actually imported in `server.py`, only `urllib.error` and `urllib.parse`.
This meant the *existing* Claude-based Assistant would have failed the
moment anyone actually sent it a real question with a real API key; every
prior test only ever confirmed the "not configured" screen, never a full
round trip, so it went unnoticed until now. Fixed as part of this same
change — Claude's tool-calling round trip is now verified working too,
via the same mock-server approach.

## New: Eight Billing, Roster, Customers & Reports Improvements

**Customers** — a Last Visit date range filter, so you can find customers
whose last visit falls in a specific window.

**Shift Roster** — each day is now a specific shift (10 AM–7 PM, 11 AM–8 PM,
or 12 PM–9 PM), not just Working/Week Off. Pick per staff, per day, from a
dropdown; "Auto-Assign" now staggers both shifts and days off.

**Billing — makeup advance linked to a booking** — entering a Makeup
Advance now offers a dropdown to link it to a specific Makeup Booking.
That booking's balance updates automatically, and stays correct if you
later edit or delete the bill (the advance is given back to the booking
first, same safety pattern as retail stock deduction).

**Billing — split payments across modes** — a bill's payment can now be
split across multiple modes (e.g. ₹2,000 Cash + ₹1,500 UPI on a ₹3,500
bill). With a single payment mode, the amount still tracks the total
automatically — no extra typing versus before. Saving is blocked if the
split doesn't add up to the Grand Total.

**Billing — date filter and pagination** — filter the bill list to a date
range, and browse 50 at a time with Previous/Next instead of one long list.

**Reports → Bill Summary — edit and delete** — every row is now clickable,
opening the same bill editor used in Billing, so corrections don't require
switching tabs.

**Reports → Product Sales (new tab)** — a date-wise report of tracked
retail product sales specifically (from Billing's Retail Products Sold),
showing quantity, sale value, and margin per sale — separate from the
general "Product Amount" field, which isn't tied to a specific product.

## New: Redesigned Dashboard

The Dashboard is now colorful and chart-based instead of plain numbers:
a 7-day revenue trend chart, a Service Mix and Client Mix donut chart, a
"This Week's Appointments" ribbon styled like a real appointment book
(click any day to see the full schedule), and Top Staff shown as bars —
all computed from your real data, no manual entry needed.

Two live reminder panels sit on the Dashboard and refresh automatically
every minute:

- **Appointments — Reminder Due**: any Upcoming appointment starting
  within the next 2 hours, with a one-tap **Send Reminder** button that
  opens WhatsApp pre-filled with a reminder message.
- **Follow-Ups Due**: any enquiry (not yet Converted or Closed) whose
  follow-up is overdue or due within 2 hours — same one-tap WhatsApp
  button. This needed a new **Follow-up Time** field alongside the
  existing Follow-up Date on Enquiries; set both to get a reminder.

Both are "free" one-tap reminders, not unattended auto-send — a person
still taps Send, exactly like every other WhatsApp touchpoint in this
app. True unattended sending would require WhatsApp's paid Business API,
which introduces the app's first ongoing cost — deliberately not done.

## Fixed: Dashboard showing appointments under the wrong day (timezone bug)

An appointment created for a specific date could appear under the *next*
day's card on the Dashboard's "This Week's Appointments" ribbon (and the
same underlying bug existed, undetected, in Shift Roster's week grid).
Root cause: date-to-string conversion was going through
`toISOString()`, which converts through UTC first — since India is
UTC+5:30, local midnight becomes 6:30 PM the *previous* day in UTC,
shifting the computed date back by one. This wasn't occasional; it
happened every time, for every appointment, on any computer set to IST
or any other timezone ahead of UTC.

Fixed by computing calendar dates directly from local date components
instead of converting through UTC — correct regardless of what timezone
the computer's clock is actually set to, not just IST specifically. This
also fixes several other date defaults across the app (today's date on
new records, membership end dates, Reports' default date ranges).

## New: Enquiry → Appointment → Bill Funnel

A new Reports tab showing conversion at each stage, for whatever date range
you pick. Since Enquiries, Appointments, and Bills aren't directly linked
records, this matches them by phone number — the best signal available
without changing how any of those get entered.

## New: Expenses

Track Date, Category, Amount, Payment Mode, Recipient, and Description
under **Expenses** — full add/edit/delete, with CSV export and a
date-range view showing your top spending categories at a glance.

## New: OT & Incentives

Under **OT & Incentives**: each staff member now has a configurable Daily
Target and Incentive % (set in Staff → Edit). The calculator takes a
staff member, date, and clock-in/clock-out time, and computes:

- **OT pay** — ₹50/hour beyond a 9-hour day, prorated by the minute, only
  once overtime reaches at least 30 minutes.
- **Incentive** — the staff's % of that day's *actual* net sales (pulled
  from real bills, correctly split if they shared a bill with someone
  else that day), paid only if the day's net sales meet or exceed their
  Daily Target.

Save any calculated day to build a running payroll history, with its own
date-range view and CSV export.

## New: No-Show & Cancellation Analytics

A new Reports tab breaking down Appointments by Source (In-Salon,
JustDial, Phone, Whatsapp, Instagram), showing no-show and cancellation
rates for each — so it's clear which follow-up channels need tightening.

## New: Per-service staff assignment in Billing

Each service line in a bill now has its own staff picker, instead of one
staff for the whole bill — for when a couple (or any two customers) come in
together and are attended by different staff. Every staff performance
number (Staff tab, Reports, the AI Assistant) now correctly credits each
staff member only for the services they actually performed, not the
whole bill's total.

## New: Bill editing and deletion

Click any bill in **Billing** to edit or delete it — the invoice number is
preserved on edit, never reassigned.

## New: Dashboard client overview

The Dashboard now shows Total Clients, New Clients (this month), Male,
Female, total Premium Services sold, and Total Enquiries at a glance.

## New: Makeup Bookings

A dedicated module for Bride, Groom, and Party makeup packages — find it
under **Makeup Bookings**. Tracks the full package: venue, location,
pricing with an auto-calculated balance, next due date, included services,
flowers/jewelry, saree draping count, number of sessions, trial completion
date, and which staff member is assigned.

## New: Editing and deleting stock — and Manage Products

Click any product row in **Current Stock** to edit its details, adjust
quantity, or remove it entirely. **Manage Products** is a dedicated,
faster page for day-to-day depletion — search or filter to Retail/Salon
Use, and hit **Mark as Over** the moment something runs out (a spa cream
finishing mid-treatment, for example). Either way, the product disappears
from Current Stock immediately.

## New: Retail products sold in Billing (auto-deducts stock)

Billing now has a **Retail Products Sold** section, separate from the
existing "Product Amount" field. Pick a specific in-stock product and
quantity, and the sale deducts from Product Inventory automatically —
tested for creating a bill, editing it to change the quantity up or down,
and deleting the bill entirely (which correctly gives the stock back).

## New: Admin role and real Profit & Loss

Every install now has a seeded login — **username `admin`, password
`admin`** — with access to everything regular logins have, plus a
dedicated **Admin — P&L** section nobody else can see. Change that
password from Backup once you've logged in.

P&L now uses real numbers, computed live: Net Salon Sales (service revenue
only) and Product Sales Margin (profit only — sale price minus landing
price, multiplied by units actually sold that month, never the full sale
value). Liability figures (Rent, EB, per-staff Salary breakdown, Salon
Expenses, OT, Incentive, Royalty) are entered per month and saved
separately for each one, with a month selector and CSV export.

## New: Product Inventory

Two tabs under **Product Inventory**:

- **Add Stock** — record a purchase from a vendor: vendor name, contact,
  GST number, invoice amount, purchase date, and payment status (or a due
  date if not yet paid), plus one or more product line items (product,
  volume, Retail/Salon Use type, landing price, sale price, an
  auto-calculated margin %, quantity, and expiry date). Each entry gets an
  automatic invoice number (`INV-VEN-0001`, etc.) — race-tested the same
  way as billing invoice numbers, so two people saving stock at the same
  moment never collide.
- **Current Stock** — two tabs, Retail and Salon Use, each showing every
  product's total purchased quantity, sale price, and expiry date, with an
  alert when something's within 10 months of expiring.

One honest limitation: Current Stock shows quantity **purchased**, not
**net of sales** — retail product sales aren't tracked at the individual-
product level yet (Billing only records a lump "Product Amount" per bill).
True running stock levels would need that connected too — a bigger, separate
piece of work if you want it.

## New: Reports, rebuilt

Reports now has five tabs, each with its own CSV export:

- **Total Sales** — pick a From/To date range and see Service Amount,
  Product Amount, Makeup Advance, Gross Sale (incl. 5% GST), and Net Sale.
  Net is calculated as Gross − 4.7% of Gross, per your salon's own rule
  (e.g. a ₹105 gross bill nets to ₹100).
- **Bill Summary** — every individual bill in the date range: customer,
  contact, service provider, gross/net value, date, services, payment mode.
- **Service Provider** — each staff member's Target, Achieved amount,
  Achieved %, Gross/Net sales, Product Sale, Clients Attended, and ABV for
  the selected range.
- **Service Performance** — click any service to expand a list of every
  customer who's taken it, with date and phone number — handy for building
  a premium-customer list.
- **Customer Report** — a breakdown by age bracket and by gender, plus a
  full list of Name, Contact, Age, and Gender.

## Billing: Product Amount and Makeup Advance

Each bill now has two optional fields — **Product Amount** and **Makeup
Advance** (₹) — for retail product sales and booking deposits, tracked
separately from the service total and rolled into the Gross/Net figures in
Reports.

## Step 3 — Connect devices on the salon WiFi (works immediately, no extra setup)

Any device connected to the **same WiFi** as the server computer can already
reach the app:

1. On the server computer, find its local IP address:
   - Windows: open Command Prompt, run `ipconfig`, look for "IPv4 Address" (e.g. `192.168.1.42`).
   - Mac: **System Settings → Wi-Fi → Details**, or run `ipconfig getifaddr en0` in Terminal.
2. On a phone connected to the same WiFi, open Chrome and go to:
   `http://<that IP address>:8765/` — e.g. `http://192.168.1.42:8765/`.
3. Log in with the account you created for that person.

This part needs no extra software. The next section is only needed for
**access from outside the salon's WiFi** (home, on the road, etc.), which is
what you asked for.

## Step 4 — Access From Anywhere (Tailscale)

To reach the salon's server from anywhere with internet — without opening
your router to the public internet, and without any third party ever seeing
your salon data — this uses **Tailscale**, a free private-networking app.
It creates an encrypted, direct connection between your own devices only,
as if they were all on one private WiFi network, no matter where they are.

**On the server computer:**
1. Go to [tailscale.com/download](https://tailscale.com/download) and install it.
2. Sign in (Google, Microsoft, email — whichever you prefer). This creates
   your private network, called a "tailnet."
3. Once connected, note the Tailscale name it's given this computer — open
   the Tailscale app/menu and look for something like
   `salon-pc.tailXXXXX.ts.net`, or run `tailscale status` in a terminal.

**On each phone (yours, your wife's, your manager's):**
1. Install the **Tailscale** app from the Play Store (or App Store on iPhone).
2. Sign in with the **same account** you used on the server computer (or
   have them sign in and then approve their device from the server
   computer's Tailscale admin console at [login.tailscale.com](https://login.tailscale.com)).
3. Once connected, open Chrome on the phone and go to:
   `http://salon-pc.tailXXXXX.ts.net:8765/` (using the actual name from
   step 3 above), or `http://<Tailscale IP>:8765/` if you prefer the IP
   (found the same way, starts with `100.`).
4. Log in with that person's account.

This now works from anywhere the phone has internet — home, travelling,
anywhere — not just the salon WiFi. The server computer does still need to
be powered on and connected to the internet for this to work, since it's
the one actually holding the data.

**Add a home-screen icon (optional, any device):** in Chrome's menu, choose
**"Add to Home screen."** It'll behave like an installed app icon, even
though it's still just opening the same web page.

## Backups

Every change saves to the server immediately. Once a day, a full dated copy
is written automatically into a `data/backups` folder next to `server.py`
on the server computer. You (or anyone logged in) can also trigger one any
time from **Backup → Back Up Now**, or download a manual copy from
**Backup → Download a Copy**.

## Security notes

- Each person has their own username and password — there is no way to use
  the app without logging in.
- For safety, no login session is remembered in the browser — everyone logs
  in again each time they reopen the app. This is deliberate, so that a
  lost or shared phone can't be used to reach your data without a password.
- Passwords are stored as salted hashes, never as plain text.
- Tailscale traffic is encrypted end-to-end between your own devices;
  Tailscale's own servers only help devices find each other, they don't see
  your salon data.

## Troubleshooting

- **A phone can't reach the app** — double-check it's on the same WiFi
  (Step 3) or signed into Tailscale with the same account (Step 4), and
  that the server computer's `start-server-*` window is still open and running.
- **"Address already in use"** — something else is using port 8765. Start
  the server with a different port, e.g. `python3 server.py --port 8766`
  (and use that port number in every URL above).
- **Forgot a password** — there's no in-app password reset yet. Ask an
  existing logged-in user to add a new login for that person from
  Backup → Team Access.
