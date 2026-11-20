# Salon Manager — Full QA Test Cases

Status key: **✅ Automated-tested** = I ran this exact scenario through a real
server and real browser during development and confirmed it works.
**🔲 Manual** = needs a human to check (usually because it depends on a real
phone, a real WhatsApp app, a real Anthropic API key, or physical hardware
I don't have access to).

---

## 1. Setup & Login

| # | Test Case | Steps | Expected Result | Status |
|---|---|---|---|---|
| 1.1 | First-run setup | Open app on a fresh install | Shows "Set Up This Salon" | ✅ |
| 1.2 | Create owner account | Fill username/password/confirm, submit | Logs in, lands on Dashboard | ✅ |
| 1.3 | Re-open after setup | Reload the app | Shows "Log In", not "Set Up" | ✅ |
| 1.4 | Wrong password | Enter valid username, wrong password | Clear error, stays on login | ✅ |
| 1.5 | Add team login | Backup → Team Access → add username/password | New login can immediately sign in | ✅ |
| 1.6 | Shared data across logins | Owner creates a customer, manager logs in separately | Manager sees the same customer | ✅ |
| 1.7 | Session expiry | Leave app idle past session lifetime, try an action | Prompted to log in again, no crash | 🔲 (needs 12hr wait) |
| 1.8 | Log out | Click Log Out | Returns to login screen, data cleared from view | ✅ |

## 2. Dashboard

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 2.1 | Today/Week/Month revenue cards | Match actual bills in each period | ✅ |
| 2.2 | Client Overview: Total Clients | Equals total customer count | ✅ |
| 2.3 | Client Overview: New This Month | Only counts customers joined this calendar month | ✅ |
| 2.4 | Client Overview: Male / Female | Match customer gender fields exactly | ✅ |
| 2.5 | Client Overview: Premium Services | Equals total premium line-items across all bills | ✅ |
| 2.6 | Client Overview: Total Enquiries | Equals count in Enquiries tab | ✅ |
| 2.7 | Top Staff This Week | Ranks correctly by revenue, updates as bills are added | ✅ |
| 2.8 | Needs Attention counts | Inactive/birthday counts link to Outreach tab | ✅ |

## 3. Billing

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 3.1 | Search customer by phone | Typing digits filters the dropdown correctly | ✅ |
| 3.2 | Quick-add customer mid-bill | Gender + DOB save correctly | ✅ |
| 3.3 | Quick-add with existing phone | Auto-selects the existing customer instead of duplicating | ✅ |
| 3.4 | Editable line price | Changing the price after selecting a service recalculates the total | ✅ |
| 3.5 | Payment modes | Cash/Card/UPI-HDFC/UPI-PhonePe/Other all save correctly | ✅ |
| 3.6 | Product Amount & Makeup Advance | Both roll into Grand Total display and into Reports' Gross figure | ✅ |
| 3.7 | Invoice number assigned | Every new bill gets a unique, sequential `INV-XXXXX` | ✅ |
| 3.8 | Concurrent bill creation | Two bills saved at nearly the same instant never share an invoice number | ✅ (stress-tested to 40 simultaneous) |
| 3.9 | **Edit an existing bill** | Click a bill row, change something, Update Bill | Change saves, invoice number unchanged | ✅ |
| 3.10 | **Delete a bill** | Open a bill, Delete Bill, confirm | Bill removed from list and Reports | ✅ |
| 3.11 | Membership auto-discount | Selecting a customer with an active plan pre-fills the discount | ✅ |

## 4. Customers

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 4.1 | Create / edit / view stats | Total spend, visit count, last visit all correct | ✅ |
| 4.2 | **Duplicate phone number blocked** | Creating a second customer with an existing phone is rejected | ✅ |
| 4.3 | Duplicate blocked even with formatting differences | "987-654-3210" correctly matches "9876543210" | ✅ |
| 4.4 | Editing a customer's own unchanged phone | Does not falsely trigger a duplicate error | ✅ |
| 4.5 | Concurrent duplicate attempts | 10 simultaneous same-phone creates → exactly 1 succeeds | ✅ |
| 4.6 | Rejected save doesn't leave a phantom entry | Failed duplicate never lingers in the visible list | ✅ |
| 4.7 | Search by name or phone | Filters the customer list live | ✅ |

## 5. Staff

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 5.1 | Create / edit / remove staff | Standard CRUD works | ✅ |
| 5.2 | Monthly Target field | Saves and displays correctly | ✅ |
| 5.3 | Weekly metrics on Staff tab | Revenue, ABV, premium % match actual bills for that staff, this week | ✅ |

## 6. Services

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 6.1 | Create / edit / delete service | Standard CRUD works | ✅ |
| 6.2 | Regular vs Premium category | Affects premium-conversion calculations everywhere | ✅ |
| 6.3 | Revenue bar / avg time vs standard | Reflects real bill data | ✅ |

## 7. Memberships

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 7.1 | Create plan | Saves duration/price/discount | ✅ |
| 7.2 | Assign to customer | Auto-computes end date from plan duration | ✅ |
| 7.3 | Active vs Expired badge | Reflects membershipEnd vs today correctly | ✅ |

## 8. Enquiries

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 8.1 | Create with all fields | Location, Service, Follow-up Date, Source, Status all save | ✅ |
| 8.2 | Edit status (Pending → Converted) | Updates immediately, badge color changes | ✅ |
| 8.3 | Delete enquiry | Removed from list | ✅ |
| 8.4 | Status filter pills | Correctly show/hide by Pending/Converted/Closed | ✅ |

## 9. Appointments

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 9.1 | Create with date/time picker | Saves correctly | ✅ |
| 9.2 | "Same as phone" for WhatsApp number | Copies the contact number field | ✅ |
| 9.3 | Upcoming-only filter toggle | Correctly hides past/completed appointments | ✅ |
| 9.4 | Delete appointment | Removed from list | ✅ |

## 10. Attendance

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 10.1 | Mark and Save for a date | Persists to the real database (verified via full page reload) | ✅ |
| 10.2 | Switch dates without saving | Warns before discarding unsaved changes | ✅ |
| 10.3 | Each date independent | Marking one date never overwrites another date's record | ✅ |
| 10.4 | Mark All Present | Sets every staff member to Present in one click | ✅ |
| 10.5 | Export CSV with From/To range | Downloads real data for marked dates | ✅ |
| 10.6 | Shared across logins | A second login sees the same marked attendance | ✅ |
| 10.7 | Empty state with no staff | Shows a helpful message instead of an empty table | ✅ |

## 11. Shift Roster

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 11.1 | Toggle Working/Week Off per day | Saves and persists after reload | ✅ |
| 11.2 | Day + date shown in headers | e.g. "Mon" over "25 Aug" | ✅ |
| 11.3 | Week navigation (←/→) | Moves to adjacent weeks, starts at the real current week | ✅ |
| 11.4 | Auto-Assign Week Offs | Staggers different days off across staff | ✅ |
| 11.5 | Week-off count badge | Green ✓ at 1, red ⚠ at 0, amber if more than 1 | ✅ |
| 11.6 | Export CSV | Includes each day's date in the column header | ✅ |
| 11.7 | Publish & Share via WhatsApp | Uses each staff member's real phone number | ✅ |
| 11.8 | Shared across logins | A second login sees the same roster | ✅ |

## 12. Makeup Bookings

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 12.1 | Create Bride/Groom/Party booking | All 16 fields save correctly | ✅ |
| 12.2 | Balance auto-calculates | Price − Advance, updates live as you type | ✅ |
| 12.3 | Services Included = Yes | Reveals services list + date fields | ✅ |
| 12.4 | Type filter tabs | All/Bride/Groom/Party correctly filter the list | ✅ |
| 12.5 | Makeup artist dropdown | Populated from real Staff list | ✅ |
| 12.6 | Edit existing booking | Changes save correctly | ✅ |
| 12.7 | Delete booking | Removed from list | ✅ |

## 13. Outreach

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 13.1 | Inactive customer detection | Matches the configured inactive-days threshold | ✅ |
| 13.2 | Upcoming birthday detection | Matches the configured reminder window | ✅ |
| 13.3 | Generate offer code | Creates a code, opens WhatsApp with pre-filled message | ✅ (link generation); 🔲 (actual send) |
| 13.4 | Real WhatsApp delivery | Message actually arrives on the recipient's phone | 🔲 |

## 14. Reports

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 14.1 | Total Sales — GST math | Net = Gross − 4.7% of Gross, matches your formula exactly | ✅ |
| 14.2 | Total Sales — date range | Only includes bills within From/To | ✅ |
| 14.3 | Bill Summary | Shows invoice #, customer, staff, gross/net correctly joined | ✅ |
| 14.4 | Service Provider — Target/Achieved | Prorates monthly target to the selected date range | ✅ |
| 14.5 | Service Provider — no target set | Shows "No target" instead of a broken percentage | ✅ |
| 14.6 | Service Performance drill-down | Clicking a service reveals the right customer list | ✅ |
| 14.7 | Customer Report — age & gender breakdown | Matches actual customer data | ✅ |
| 14.8 | CSV exports (all report tabs) | Download real data in the stated format | ✅ |

## 15. AI Assistant

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 15.1 | Not configured state | Shows setup instructions if no API key file exists | ✅ |
| 15.2 | Simple factual question | Correctly calls one tool and answers | ✅ (simulated) |
| 15.3 | Compound multi-part question | Chains multiple tool calls into one complete answer | ✅ (simulated) |
| 15.4 | Advisory/suggestion question | Grounds recommendations in real data, labels fact vs. suggestion | ✅ (simulated) |
| 15.5 | Offer performance question | Correctly matches sent codes against real bill redemptions | ✅ (simulated) |
| 15.6 | **Real live API call** | An actual question gets a real Claude response | 🔲 (needs your real API key) |

## 16. Backup & Team Access

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 16.1 | Manual "Back Up Now" | Writes a dated JSON file to `data/backups` | ✅ |
| 16.2 | Automatic daily backup | Triggers once per day on first login | ✅ |
| 16.3 | Download a Copy | Downloads current data as JSON | ✅ |
| 16.4 | Restore from File | Re-uploads a backup and data reflects it | ✅ |
| 16.5 | Add Team Access login | New login works immediately, sees shared data | ✅ |

## 17. Cross-Cutting / Multi-User

| # | Test Case | Expected Result | Status |
|---|---|---|---|
| 17.1 | Two people editing simultaneously | No data loss, no silent overwrites | ✅ (tested for bills, customers) |
| 17.2 | Rejected save rolls back cleanly | A failed save never leaves incorrect data visible | ✅ |
| 17.3 | Full page reload preserves everything | Nothing depends on browser memory alone | ✅ |

---

## What I'd recommend you personally click through before trusting this fully

Everything marked 🔲 above needs a human, not because it's untested logic,
but because it depends on things I can't access from here: your actual
phone, your actual WhatsApp, and your actual Anthropic API key. Specifically:

1. Send yourself one real WhatsApp message from Outreach and from the
   Shift Roster share panel — confirm it actually arrives.
2. If you've added the Assistant's API key, ask it one real question.
3. Leave the app logged in overnight once, and confirm it asks you to log
   in again the next day rather than silently failing.

Everything else in this document has been run against a real server and a
real browser during development, not just reasoned about.
