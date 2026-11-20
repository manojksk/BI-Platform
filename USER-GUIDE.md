# Salon Manager — User Guide

## Contents

1. Logging In & Roles
2. Dashboard
3. Billing
4. Customers
5. Staff
6. Services
7. Memberships
8. Enquiries
9. Appointments
10. Attendance
11. Shift Roster
12. Makeup Bookings
13. Product Inventory
14. Manage Products
15. Expenses
16. OT & Incentives
17. Outreach
18. Reports
19. Admin — Profit & Loss
20. AI Assistant
21. Backup & Team Access

---

## 1. Logging In & Roles

The first person to set up the app becomes the **owner**. Anyone added
afterward (Backup → Team Access) is **staff** — same access, different
login. A special **admin** login (username and password both `admin`)
exists automatically and is the only login that can see the Profit & Loss
section. Change the admin password after your first login (Backup screen).

## 2. Dashboard

Your at-a-glance view when you log in: Today/This Week/This Month
revenue, a Client Overview row (Total Clients, New This Month, Male,
Female, Premium Services sold, Total Enquiries), Top Staff This Week, and
quick links to Inactive Customers and Upcoming Birthdays under "Needs
Attention."

## 3. Billing

**Create a bill:** click **+ New Bill**, search for the customer by phone
or name (or add them on the spot), then add one or more services. **Each
service line has its own staff picker** — useful when two customers on
one bill (a couple, for example) are attended by different staff members.
Prices are editable per line for on-spot discounts. A discount % applies
to the whole bill.

**Retail Products Sold:** a separate section below the services — pick a
specific in-stock product and quantity to sell it as part of the bill.
This automatically deducts that quantity from Product Inventory. It's
separate from the general "Product Amount" field, which is for anything
not tracked in inventory.

**Editing and deleting:** click any bill in the list to edit it or delete
it entirely. The invoice number never changes on edit. If you edit or
delete a bill that included a tracked retail product, stock is
automatically adjusted to match.

## 4. Customers

Standard add/edit. **Phone number must be unique** — trying to create a
second customer with an existing number will point you to the existing
one instead. The customer's card shows total spend, visit count, and
last visit at a glance.

## 5. Staff

Add/edit staff with name, role, and phone. Two fields matter beyond
day-to-day display:
- **Monthly Target** — used for the Service Provider report's
  achievement %.
- **Daily Target** and **Incentive %** — used by OT & Incentives to
  calculate that staff member's daily incentive pay.

## 6. Services

Add/edit services with a price and category (**Regular** or **Premium**).
The Premium category drives premium-conversion tracking throughout
Reports and the AI Assistant.

## 7. Memberships

Create membership plans (duration, price, discount %). Assigning a plan
to a customer auto-computes their membership end date and auto-applies
their discount on future bills while active.

## 8. Enquiries

Log a lead with location, interested service, source (In-Salon, JustDial,
Phone, Whatsapp, Instagram), a follow-up date, and a status (Pending /
Converted / Closed). Filter the list by status using the pills at the top.

## 9. Appointments

Book a future visit with name, phone, WhatsApp number (a "Same" button
copies the phone number), date/time, gender, and source. Status
(Upcoming / Completed / Cancelled / No-show) feeds directly into the
No-Show Analytics report.

## 10. Attendance

Pick a date, mark each staff member's status (Present / Absent / Half Day
/ On Leave / Week Off), and click **Save Attendance**. Each date is its
own independent record — switching dates without saving warns you first.
Export a CSV for a date range from the panel below the table.

## 11. Shift Roster

A staff-by-day grid for the current (or any) week — click a cell to
toggle Working/Week Off. **Auto-Assign Week Offs** staggers days off so
the salon isn't short-staffed on any single day. **Publish & Share**
opens a per-employee WhatsApp message with their week's schedule (one tap
per person — WhatsApp doesn't support true bulk sending). Export the
roster as a CSV.

## 12. Makeup Bookings

Three types — **Bride**, **Groom**, **Party** — each with the full
package details: venue, location, price, advance received, an
auto-calculated balance, next due date, included services, flowers,
jewelry, saree draping count, number of sessions, trial completion date,
and the assigned makeup artist. Filter the list by type using the tabs.

## 13. Product Inventory

**Add Stock:** record one vendor invoice at a time — vendor details
(name, contact, GST number, invoice amount, purchase date, payment
status) at the top, then one or more products below (name, volume, type
— Retail or Salon Use —, landing price, sale price, an auto-calculated
margin %, quantity, and expiry date).

**Current Stock:** two tabs, Retail and Salon Use, showing every
product's invoice number, available quantity, sale price, and expiry
date, with a warning banner when something is within 10 months of
expiring. Click any row to edit its details or remove it from stock
entirely.

*Note: Current Stock shows quantity purchased minus quantity sold through
Billing's Retail Products Sold section — it does not know about products
consumed outside of a sale (see Manage Products for that).*

## 14. Manage Products

A faster, focused list of everything currently in stock — search or
filter by Retail/Salon Use, and hit **Mark as Over** the instant something
runs out (a spa cream finishing mid-treatment, for example). This removes
it from Current Stock immediately, same as deleting it there, but without
needing to open the full invoice it came from.

## 15. Expenses

Log Date, Category, Amount, Payment Mode, Recipient, and Description for
any business cost — rent, utilities, supplies, anything. Pick a date
range to see totals and your top spending categories, and export to CSV.

## 16. OT & Incentives

**Staff Configuration** shows every staff member's Daily Target and
Incentive % (edit these under Staff if you need to change them).

**Daily Calculator:** pick a staff member, date, and their clock-in/
clock-out time. It computes:
- **OT pay:** ₹50/hour beyond a 9-hour day, prorated by the minute, only
  once overtime reaches at least 30 minutes (20 minutes over = ₹0; 90
  minutes over = ₹75).
- **Incentive:** their % of that day's actual net sales — pulled from
  real bills, correctly split if they shared a bill with another staff
  member — paid only if that day's net sales meet or exceed their Daily
  Target.

Click **Save to Payroll** to add it to a running history below, with its
own date range and CSV export.

## 17. Outreach

Two automatic lists: customers inactive past your configured threshold,
and customers with an upcoming birthday. Generate a discount code for
either and send it via a pre-filled WhatsApp message.

## 18. Reports

Seven tabs, each with a From/To date picker and CSV export:

- **Total Sales** — Service, Product, and Makeup Advance amounts, plus
  Gross and Net (GST-adjusted) totals.
- **Bill Summary** — every bill in range: invoice #, customer, all staff
  involved, gross/net, services, payment mode.
- **Service Provider** — per staff: prorated target, achieved amount and
  %, gross/net sales, product sales, clients attended, average bill
  value. Correctly splits credit when staff share a bill.
- **Service Performance** — revenue by service, with a click-to-expand
  list of every customer who's had that service.
- **Customer Report** — age bracket and gender breakdowns, plus the full
  customer list.
- **Enquiry→Bill Funnel** — how many enquiries became appointments, and
  how many of those became paid bills, matched by phone number.
- **No-Show Analytics** — no-show and cancellation rates by appointment
  source, flagging the channel that needs the most follow-up attention.

## 19. Admin — Profit & Loss

Visible only to the `admin` login. Pick a month (← → to navigate) to see:

- **Income:** Net Salon Sales (service revenue) and Product Sales Margin
  (profit only — sale price minus landing price, for units actually sold
  that month, never the full sale value).
- **Liability:** Rent, EB, a per-staff Salary breakup, Salon Expenses,
  OT, Incentive, and Royalty — all editable, saved separately for each
  month.
- **Profit or Loss:** Total Net Sales minus Total Liability, shown
  prominently with an export option.

## 20. AI Assistant

Ask plain-English questions about your own data — simple ones ("list my
staff") or compound ones ("show me Kavya's sales last week, her premium
services, and how many customers didn't convert"). It can also give
advice when asked ("what offers should we focus on?"), grounding every
suggestion in your actual numbers rather than generic advice. Requires a
one-time Anthropic API key setup (see README.md) and has a small
per-question cost billed to your own Anthropic account.

## 21. Backup & Team Access

**Team Access:** add a login for your wife, manager, or any staff member
— they immediately share the same data.

**Backup:** a backup runs automatically once a day; **Back Up Now**
triggers one manually. **Download a Copy** saves your data as a JSON file
you can keep anywhere; **Restore from File** loads a previous backup back
in.
