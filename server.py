#!/usr/bin/env python3
"""
Salon Manager - Server
A self-contained backend: no pip installs, standard library only.

What it does:
- Stores all salon data in a local SQLite database file (salon.db), in the
  same folder as this script, or wherever --data-dir points.
- Serves a small JSON API for the app (customers, staff, services, bills,
  membership plans, offer codes, outreach log, settings).
- Serves the bundled frontend (salon-manager-remote.html) at "/".
- Requires a username + password to use the API (created on first run).
- Writes a dated JSON backup once a day into a "backups" subfolder.
- One-time auto-import of an existing salon-data.json file, if present,
  the first time the database is created (continuity with the older,
  single-computer version of this app).

Run it with:
    python3 server.py
Then open http://localhost:8765/ (or the LAN/Tailscale address of this
computer) in Chrome or Edge on any device.
"""

import http.server
import socketserver
import sqlite3
import json
import os
import sys
import hashlib
import secrets
import uuid
import datetime
import argparse
import threading
import time
from urllib.parse import urlparse, parse_qs

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

ENTITY_TABLES = {
    "customers": "customers",
    "staff": "staff",
    "services": "services",
    "bills": "bills",
    "membership-plans": "membership_plans",
    "offer-codes": "offer_codes",
    "outreach-log": "outreach_log",
    "enquiries": "enquiries",
    "appointments": "appointments",
    "attendance": "attendance",
    "roster": "roster",
    "makeup-bookings": "makeup_bookings",
    "stock-entries": "stock_entries",
    "pnl-liabilities": "pnl_liabilities",
    "expenses": "expenses",
    "payroll-records": "payroll_records",
}

SESSION_LIFETIME_SECONDS = 12 * 60 * 60  # 12 hours
SESSIONS = {}  # token -> {"username": str, "created": float}
SESSIONS_LOCK = threading.Lock()
INVOICE_COUNTER_LOCK = threading.Lock()
STOCK_INVOICE_LOCK = threading.Lock()
MAKEUP_ADVANCE_LOCK = threading.Lock()
CUSTOMER_PHONE_LOCK = threading.Lock()

DEFAULT_SETTINGS = {
    "salonName": "My Salon",
    "inactiveDays": 45,
    "birthdayWindowDays": 7,
    "lastBackupISO": None,
}


# ---------------------------------------------------------------- storage --

def get_db_path(data_dir):
    return os.path.join(data_dir, "salon.db")


def connect(data_dir):
    conn = sqlite3.connect(get_db_path(data_dir), timeout=10)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.row_factory = sqlite3.Row
    return conn


def init_db(data_dir):
    is_new = not os.path.exists(get_db_path(data_dir))
    conn = connect(data_dir)
    with conn:
        for table in ENTITY_TABLES.values():
            conn.execute(
                f"CREATE TABLE IF NOT EXISTS {table} "
                "(id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)"
            )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS users "
            "(username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, "
            "salt TEXT NOT NULL, created_at TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff')"
        )
        # migration: older DBs created before the role column existed
        existing_cols = [r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
        if "role" not in existing_cols:
            conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'staff'")
        cur = conn.execute("SELECT value FROM settings WHERE key='settings'")
        if cur.fetchone() is None:
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('settings', ?)",
                (json.dumps(DEFAULT_SETTINGS),),
            )
        # Ensure every install has exactly one admin-role account, seeded automatically.
        # Covers both fresh installs and existing ones upgrading in after this feature.
        admin_exists = conn.execute("SELECT 1 FROM users WHERE role='admin'").fetchone()
        if not admin_exists:
            existing_admin_username = conn.execute("SELECT 1 FROM users WHERE username='admin'").fetchone()
            if existing_admin_username:
                conn.execute("UPDATE users SET role='admin' WHERE username='admin'")
            else:
                pw_hash, salt = hash_password("admin")
                conn.execute(
                    "INSERT INTO users (username, password_hash, salt, created_at, role) VALUES (?, ?, ?, ?, 'admin')",
                    ("admin", pw_hash, salt, now_iso()),
                )
    conn.close()

    if is_new:
        legacy_path = os.path.join(data_dir, "salon-data.json")
        if os.path.exists(legacy_path):
            try:
                import_legacy_json(data_dir, legacy_path)
                print(f"Imported existing data from {legacy_path}")
            except Exception as e:
                print(f"Could not auto-import {legacy_path}: {e}")


def import_legacy_json(data_dir, path):
    """One-time migration from the old single-computer salon-data.json file."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    conn = connect(data_dir)
    now = now_iso()
    with conn:
        for key, table in ENTITY_TABLES.items():
            field = to_camel(table)
            for record in data.get(field, []):
                rid = record.get("id") or str(uuid.uuid4())
                conn.execute(
                    f"INSERT OR REPLACE INTO {table} (id, data, updated_at) VALUES (?, ?, ?)",
                    (rid, json.dumps(record), now),
                )
        if "settings" in data and data["settings"]:
            merged = {**DEFAULT_SETTINGS, **data["settings"]}
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('settings', ?)",
                (json.dumps(merged),),
            )
    conn.close()


def _normalize_phone(phone):
    return ''.join(ch for ch in (phone or '') if ch.isdigit())


def _find_customer_by_phone(conn, phone, exclude_id=None):
    normalized = _normalize_phone(phone)
    if not normalized:
        return None
    rows = conn.execute("SELECT id, data FROM customers").fetchall()
    for r in rows:
        if exclude_id and r["id"] == exclude_id:
            continue
        existing = json.loads(r["data"])
        if _normalize_phone(existing.get("phone")) == normalized:
            return existing
    return None


def _apply_retail_stock_delta(conn, old_retail_products, new_retail_products):
    """Reconciles stock_entries quantities by the delta between a bill's old
    and new retailProducts lists. Used for create (old=[]), update (delta
    could go either way), and delete (new=[], giving stock back). Caller
    must hold STOCK_INVOICE_LOCK."""
    old_by_key = {}
    for rp in (old_retail_products or []):
        key = (rp.get("stockEntryId"), rp.get("productLineId"))
        old_by_key[key] = old_by_key.get(key, 0) + (rp.get("quantity", 0) or 0)
    new_by_key = {}
    for rp in (new_retail_products or []):
        key = (rp.get("stockEntryId"), rp.get("productLineId"))
        new_by_key[key] = new_by_key.get(key, 0) + (rp.get("quantity", 0) or 0)

    all_keys = set(old_by_key) | set(new_by_key)
    if not all_keys:
        return
    stock_rows = conn.execute("SELECT id, data FROM stock_entries").fetchall()
    stock_by_id = {r["id"]: json.loads(r["data"]) for r in stock_rows}
    changed_ids = set()
    for (entry_id, product_id) in all_keys:
        entry = stock_by_id.get(entry_id)
        if not entry:
            continue
        delta = new_by_key.get((entry_id, product_id), 0) - old_by_key.get((entry_id, product_id), 0)
        if delta == 0:
            continue
        for prod in entry.get("products", []):
            if prod.get("id") == product_id:
                prod["quantity"] = max(0, (prod.get("quantity", 0) or 0) - delta)
                changed_ids.add(entry_id)
    with conn:
        for eid in changed_ids:
            conn.execute(
                "UPDATE stock_entries SET data=?, updated_at=? WHERE id=?",
                (json.dumps(stock_by_id[eid]), now_iso(), eid),
            )


def _apply_makeup_advance_delta(conn, old_linked_id, old_advance, new_linked_id, new_advance):
    """Reconciles a makeup_bookings row's advanceReceived when a bill's linked
    booking and/or makeup advance amount changes. Mirrors
    _apply_retail_stock_delta's create/update/delete delta pattern. Caller
    must hold MAKEUP_ADVANCE_LOCK."""
    old_linked_id = old_linked_id or None
    new_linked_id = new_linked_id or None
    old_advance = old_advance or 0
    new_advance = new_advance or 0
    if old_linked_id == new_linked_id and old_advance == new_advance:
        return
    ids_to_touch = {i for i in (old_linked_id, new_linked_id) if i}
    if not ids_to_touch:
        return
    rows = conn.execute(
        f"SELECT id, data FROM makeup_bookings WHERE id IN ({','.join('?' * len(ids_to_touch))})",
        tuple(ids_to_touch),
    ).fetchall()
    bookings = {r["id"]: json.loads(r["data"]) for r in rows}
    if old_linked_id and old_linked_id in bookings:
        b = bookings[old_linked_id]
        b["advanceReceived"] = max(0, (b.get("advanceReceived", 0) or 0) - old_advance)
    if new_linked_id and new_linked_id in bookings:
        b = bookings[new_linked_id]
        b["advanceReceived"] = (b.get("advanceReceived", 0) or 0) + new_advance
    with conn:
        for bid, data in bookings.items():
            if bid in ids_to_touch:
                conn.execute(
                    "UPDATE makeup_bookings SET data=?, updated_at=? WHERE id=?",
                    (json.dumps(data), now_iso(), bid),
                )


def to_camel(table_name):
    parts = table_name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def today_str():
    return datetime.date.today().isoformat()


# ------------------------------------------------------------------- auth --

def hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 100_000)
    return digest.hex(), salt


def verify_password(password, salt, expected_hash):
    digest, _ = hash_password(password, salt)
    return secrets.compare_digest(digest, expected_hash)


def create_session(username):
    token = secrets.token_hex(32)
    with SESSIONS_LOCK:
        SESSIONS[token] = {"username": username, "created": time.time()}
    return token


def get_session_user(token):
    with SESSIONS_LOCK:
        entry = SESSIONS.get(token)
        if not entry:
            return None
        if time.time() - entry["created"] > SESSION_LIFETIME_SECONDS:
            del SESSIONS[token]
            return None
        return entry["username"]


def any_users_exist(data_dir):
    # The seeded 'admin' account (role='admin') is infrastructure, not a completed
    # owner setup -- only count owner/staff accounts for the first-run gate.
    conn = connect(data_dir)
    cur = conn.execute("SELECT COUNT(*) as c FROM users WHERE role != 'admin'")
    count = cur.fetchone()["c"]
    conn.close()
    return count > 0


# --------------------------------------------------------------- backups --

def maybe_run_daily_backup(data_dir):
    conn = connect(data_dir)
    cur = conn.execute("SELECT value FROM settings WHERE key='settings'")
    row = cur.fetchone()
    settings = json.loads(row["value"]) if row else dict(DEFAULT_SETTINGS)
    last = settings.get("lastBackupISO")
    due = True
    if last:
        try:
            last_dt = datetime.datetime.fromisoformat(last)
            due = (datetime.datetime.now(datetime.timezone.utc) - last_dt).total_seconds() > 24 * 3600
        except Exception:
            due = True
    if due:
        write_backup(data_dir, conn)
        settings["lastBackupISO"] = now_iso()
        with conn:
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('settings', ?)",
                (json.dumps(settings),),
            )
    conn.close()


def write_backup(data_dir, conn):
    backups_dir = os.path.join(data_dir, "backups")
    os.makedirs(backups_dir, exist_ok=True)
    dump = {"exportedAt": now_iso(), "version": 2}
    for key, table in ENTITY_TABLES.items():
        field = to_camel(table)
        rows = conn.execute(f"SELECT data FROM {table}").fetchall()
        dump[field] = [json.loads(r["data"]) for r in rows]
    row = conn.execute("SELECT value FROM settings WHERE key='settings'").fetchone()
    dump["settings"] = json.loads(row["value"]) if row else dict(DEFAULT_SETTINGS)
    out_path = os.path.join(backups_dir, f"salon-backup-{today_str()}.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(dump, f, indent=2)


# ------------------------------------------------------------- AI assistant --
import urllib.error
import urllib.request
import difflib

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
DEFAULT_MODEL = "claude-haiku-4-5-20251001"
MAX_TOOL_ITERATIONS = 6

ASSISTANT_SYSTEM_PROMPT = (
    "You are the data assistant built into a salon's management app. You answer the "
    "salon owner or manager's questions about their own customers, staff, services, "
    "bills, enquiries, and appointments by calling the tools provided -- never guess or "
    "make up numbers. Always call a tool to look something up before answering a "
    "factual question, and make multiple tool calls in sequence when a question has "
    "several parts (e.g. a staff member's sales AND their premium services AND who "
    "didn't convert -- that's up to three separate tool calls, not one). Amounts are in "
    "Indian Rupees; format them like '\u20b91,250'. Keep factual answers short, concrete, "
    "and conversational -- a sentence or a short list, not a report. If a name given "
    "doesn't match anyone closely, say so and name the closest matches instead of "
    "guessing.\n\n"
    "You can also be asked for advice: what to improve, what offers to run, or how the "
    "business is trending. For these, gather real data first -- get_business_summary "
    "(call it for two different periods to compare a trend), get_offer_code_performance "
    "before recommending any offer, get_age_bracket_summary or get_staff_report as "
    "relevant -- and base every recommendation on a specific number you actually "
    "retrieved. Never invent generic marketing advice that isn't tied to this salon's "
    "own data. Clearly separate what the data shows from what you're suggesting, e.g. "
    "'Premium conversion for Under 25 is 12% versus 45% for 25-39 (fact) -- consider a "
    "lower-priced trial premium service for that age group (suggestion).' Always end "
    "advisory answers by naming the specific numbers that back the suggestion, so the "
    "manager can judge it themselves rather than just trusting you. These are "
    "suggestions for a human to weigh, not decisions -- never phrase them as certain."
)


def get_api_key(data_dir):
    env_key = os.environ.get("ANTHROPIC_API_KEY")
    if env_key:
        return env_key.strip()
    key_path = os.path.join(data_dir, "anthropic-api-key.txt")
    if os.path.exists(key_path):
        with open(key_path, "r", encoding="utf-8") as f:
            return f.read().strip()
    return None


def get_gemini_api_key(data_dir):
    env_key = os.environ.get("GEMINI_API_KEY")
    if env_key:
        return env_key.strip()
    key_path = os.path.join(data_dir, "gemini-api-key.txt")
    if os.path.exists(key_path):
        with open(key_path, "r", encoding="utf-8") as f:
            return f.read().strip()
    return None


def get_gemini_model(data_dir):
    """Google deprecates Flash-tier model names every few weeks -- letting
    this be overridden by a plain text file (same pattern as the API key)
    means a deprecation can be fixed by editing one file and restarting,
    without needing a code change each time."""
    env_model = os.environ.get("GEMINI_MODEL")
    if env_model:
        return env_model.strip()
    model_path = os.path.join(data_dir, "gemini-model.txt")
    if os.path.exists(model_path):
        with open(model_path, "r", encoding="utf-8") as f:
            content = f.read().strip()
            if content:
                return content
    return DEFAULT_GEMINI_MODEL


def _load_table(conn, table):
    return [json.loads(r["data"]) for r in conn.execute(f"SELECT data FROM {table}").fetchall()]


def _find_staff(conn, name_query):
    staff = _load_table(conn, "staff")
    if not staff:
        return None, staff
    names = [s["name"] for s in staff]
    exact = [s for s in staff if s["name"].lower() == name_query.lower()]
    if exact:
        return exact[0], staff
    contains = [s for s in staff if name_query.lower() in s["name"].lower()]
    if len(contains) == 1:
        return contains[0], staff
    close = difflib.get_close_matches(name_query, names, n=1, cutoff=0.5)
    if close:
        return next(s for s in staff if s["name"] == close[0]), staff
    return None, staff


def _parse_date_range(start_date, end_date, default_days=7):
    if end_date:
        end_dt = datetime.datetime.fromisoformat(end_date) + datetime.timedelta(days=1)
    else:
        end_dt = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)
    if start_date:
        start_dt = datetime.datetime.fromisoformat(start_date)
    else:
        start_dt = end_dt - datetime.timedelta(days=default_days + 1)
    return start_dt, end_dt


def _bill_dt(bill):
    d = bill.get("date", "")
    try:
        return datetime.datetime.fromisoformat(d.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return datetime.datetime.min


def _item_staff_id(item, bill):
    """A bill can span multiple staff (e.g. a couple, each attended by someone
    different) -- each item may carry its own staffId; fall back to the bill's
    for older records saved before per-item staff assignment existed."""
    return item.get("staffId") or bill.get("staffId") or ""


def _get_age_bracket(dob):
    if not dob:
        return "Unknown"
    try:
        d = datetime.date.fromisoformat(dob)
    except Exception:
        return "Unknown"
    today = datetime.date.today()
    age = today.year - d.year - ((today.month, today.day) < (d.month, d.day))
    if age < 25:
        return "Under 25"
    if age < 40:
        return "25-39"
    if age < 55:
        return "40-54"
    return "55+"


def tool_get_staff_report(data_dir, staff_name, start_date=None, end_date=None):
    conn = connect(data_dir)
    staff, all_staff = _find_staff(conn, staff_name)
    if not staff:
        conn.close()
        names = ", ".join(s["name"] for s in all_staff) or "no staff on file yet"
        return {"error": f"No staff member matching '{staff_name}'. On file: {names}"}
    start_dt, end_dt = _parse_date_range(start_date, end_date)
    all_bills = [b for b in _load_table(conn, "bills") if start_dt <= _bill_dt(b) < end_dt]
    services_by_id = {s["id"]: s for s in _load_table(conn, "services")}
    customers_by_id = {c["id"]: c for c in _load_table(conn, "customers")}
    conn.close()

    sid = staff["id"]
    # Items this staff actually performed -- not just bills where they're the
    # bill-level default, since one bill can span multiple staff (e.g. a couple).
    my_items = [(b, it) for b in all_bills for it in b.get("items", []) if _item_staff_id(it, b) == sid]

    def discount_adjusted(item, bill):
        return (item.get("price", 0) or 0) * (1 - (bill.get("discountPercent", 0) or 0) / 100)

    revenue = sum(discount_adjusted(it, b) for b, it in my_items)

    # Bill-level extras (Product Amount, Makeup Advance) aren't tied to a specific
    # service, so attribute them once per bill to that bill's primary (first item's)
    # staff -- avoids double-counting the same rupees against two different staff.
    product_sale, makeup_advance = 0.0, 0.0
    for b in all_bills:
        items = b.get("items", [])
        if items and _item_staff_id(items[0], b) == sid:
            product_sale += b.get("productAmount", 0) or 0
            makeup_advance += b.get("makeupAdvance", 0) or 0

    gross = revenue + product_sale + makeup_advance
    net = gross * (1 - 0.047)

    bill_ids_for_staff = set(b["id"] for b, it in my_items)
    total_bills = len(bill_ids_for_staff)
    unique_customers = len(set(b.get("customerId") for b, it in my_items))
    abv = gross / total_bills if total_bills else 0

    premium_bill_ids = set(b["id"] for b, it in my_items if services_by_id.get(it.get("serviceId"), {}).get("category") == "Premium")
    premium_pct = (len(premium_bill_ids) / total_bills * 100) if total_bills else 0

    mins, std_mins, item_count = 0, 0, 0
    for b, it in my_items:
        if isinstance(it.get("durationMins"), (int, float)):
            mins += it["durationMins"]
            item_count += 1
        svc = services_by_id.get(it.get("serviceId"))
        if svc:
            std_mins += svc.get("standardMins", 0) or 0

    # Customers this staff member personally served but did NOT sell a premium
    # service to (i.e. no upsell/conversion from THIS staff) -- for follow-up/coaching.
    customers_with_premium = set(b.get("customerId") for b, it in my_items if services_by_id.get(it.get("serviceId"), {}).get("category") == "Premium")
    customers_served = set(b.get("customerId") for b, it in my_items)
    non_converted_ids = customers_served - customers_with_premium
    non_converted_names = sorted(set(
        customers_by_id.get(cid, {}).get("name", "Unknown") for cid in non_converted_ids
    ))

    monthly_target = staff.get("monthlyTarget", 0) or 0
    days = max(1, (end_dt - start_dt).days)
    target_for_period = monthly_target * (days / 30.44)
    achieved_pct = (gross / target_for_period * 100) if target_for_period > 0 else None

    return {
        "staff_name": staff["name"],
        "period": f"{start_dt.date().isoformat()} to {(end_dt - datetime.timedelta(days=1)).date().isoformat()}",
        "service_revenue_inr": round(revenue),
        "product_sale_inr": round(product_sale),
        "makeup_advance_inr": round(makeup_advance),
        "gross_sales_inr": round(gross),
        "net_sales_inr": round(net),
        "monthly_target_inr": round(monthly_target) if monthly_target else None,
        "target_for_this_period_inr": round(target_for_period) if target_for_period else None,
        "achieved_percent_of_target": round(achieved_pct, 1) if achieved_pct is not None else None,
        "total_bills": total_bills,
        "unique_customers": unique_customers,
        "average_bill_value_inr": round(abv),
        "premium_conversion_percent": round(premium_pct, 1),
        "customers_with_no_premium_conversion_count": len(non_converted_ids),
        "customers_with_no_premium_conversion": non_converted_names,
        "average_service_minutes": round(mins / item_count, 1) if item_count else None,
        "average_standard_minutes": round(std_mins / item_count, 1) if item_count else None,
    }


def tool_get_premium_services_by_staff(data_dir, staff_name, start_date=None, end_date=None):
    conn = connect(data_dir)
    staff, all_staff = _find_staff(conn, staff_name)
    if not staff:
        conn.close()
        names = ", ".join(s["name"] for s in all_staff) or "no staff on file yet"
        return {"error": f"No staff member matching '{staff_name}'. On file: {names}"}
    bills = _load_table(conn, "bills")
    if start_date or end_date:
        start_dt, end_dt = _parse_date_range(start_date, end_date, default_days=36500)  # effectively "all time" if only one bound given
        bills = [b for b in bills if start_dt <= _bill_dt(b) < end_dt]
    services_by_id = {s["id"]: s for s in _load_table(conn, "services")}
    customers_by_id = {c["id"]: c for c in _load_table(conn, "customers")}
    conn.close()

    rows = []
    for b in bills:
        for it in b.get("items", []):
            if _item_staff_id(it, b) != staff["id"]:
                continue  # a bill can span multiple staff -- only count services THIS staff actually performed
            svc = services_by_id.get(it.get("serviceId"))
            if svc and svc.get("category") == "Premium":
                cust = customers_by_id.get(b.get("customerId"), {})
                rows.append({
                    "date": b.get("date", "")[:10],
                    "service": svc["name"],
                    "customer": cust.get("name", "Unknown"),
                    "price_inr": it.get("price", 0),
                })
    rows.sort(key=lambda r: r["date"], reverse=True)
    return {"staff_name": staff["name"], "premium_services_count": len(rows), "premium_services": rows[:50]}


def tool_get_age_bracket_summary(data_dir):
    conn = connect(data_dir)
    customers_by_id = {c["id"]: c for c in _load_table(conn, "customers")}
    bills = _load_table(conn, "bills")
    services_by_id = {s["id"]: s for s in _load_table(conn, "services")}
    conn.close()

    brackets = {"Under 25": {"visits": 0, "revenue": 0, "premium_visits": 0},
                "25-39": {"visits": 0, "revenue": 0, "premium_visits": 0},
                "40-54": {"visits": 0, "revenue": 0, "premium_visits": 0},
                "55+": {"visits": 0, "revenue": 0, "premium_visits": 0},
                "Unknown": {"visits": 0, "revenue": 0, "premium_visits": 0}}
    for b in bills:
        cust = customers_by_id.get(b.get("customerId"))
        bracket = _get_age_bracket(cust.get("dob") if cust else None)
        brackets[bracket]["visits"] += 1
        brackets[bracket]["revenue"] += b.get("total", 0)
        if any(services_by_id.get(it.get("serviceId"), {}).get("category") == "Premium" for it in b.get("items", [])):
            brackets[bracket]["premium_visits"] += 1
    return {"by_age_bracket": brackets}


def tool_get_enquiries(data_dir, status=None, source=None):
    conn = connect(data_dir)
    enquiries = _load_table(conn, "enquiries")
    services_by_id = {s["id"]: s for s in _load_table(conn, "services")}
    conn.close()
    if status:
        enquiries = [e for e in enquiries if e.get("status", "").lower() == status.lower()]
    if source:
        enquiries = [e for e in enquiries if e.get("source", "").lower() == source.lower()]
    enquiries.sort(key=lambda e: e.get("date", ""), reverse=True)
    out = []
    for e in enquiries[:50]:
        svc = services_by_id.get(e.get("serviceId"))
        out.append({
            "client_name": e.get("customerName"), "phone": e.get("phone"), "location": e.get("location"),
            "service_interested": svc["name"] if svc else None, "date": e.get("date"),
            "follow_up_date": e.get("followUpDate"), "source": e.get("source"),
            "status": e.get("status"), "notes": e.get("notes"),
        })
    return {"count": len(enquiries), "enquiries": out}


def tool_list_staff(data_dir):
    conn = connect(data_dir)
    staff = _load_table(conn, "staff")
    conn.close()
    return {"staff": [{"name": s["name"], "role": s.get("role", "")} for s in staff]}


def tool_list_services(data_dir):
    conn = connect(data_dir)
    services = _load_table(conn, "services")
    conn.close()
    return {"services": [{"name": s["name"], "category": s.get("category"), "price_inr": s.get("price")} for s in services]}


def tool_get_appointments(data_dir, upcoming_only=True):
    conn = connect(data_dir)
    appointments = _load_table(conn, "appointments")
    conn.close()
    now = datetime.datetime.now()
    if upcoming_only:
        appointments = [a for a in appointments if a.get("dateTime") and a["dateTime"] >= now.isoformat()[:16] and a.get("status") == "Upcoming"]
    appointments.sort(key=lambda a: a.get("dateTime", ""))
    out = [{"name": a.get("name"), "phone": a.get("phone"), "date_time": a.get("dateTime"), "source": a.get("source"), "status": a.get("status")} for a in appointments[:50]]
    return {"count": len(out), "appointments": out}


def tool_get_offer_code_performance(data_dir):
    """Correlates offer codes generated via Outreach against actual bill
    redemptions, so 'what offers work' can be answered from real evidence
    instead of generic guesses."""
    conn = connect(data_dir)
    codes = _load_table(conn, "offer_codes")
    bills = _load_table(conn, "bills")
    conn.close()

    redeemed_codes = set()
    for b in bills:
        code = (b.get("offerCode") or "").strip().upper()
        if code:
            redeemed_codes.add(code)

    by_type = {}
    for c in codes:
        t = c.get("type", "unknown")
        by_type.setdefault(t, {"sent": 0, "redeemed": 0, "discount_percents": []})
        by_type[t]["sent"] += 1
        by_type[t]["discount_percents"].append(c.get("discountPercent", 0))
        if (c.get("code") or "").strip().upper() in redeemed_codes:
            by_type[t]["redeemed"] += 1

    summary = []
    for t, d in by_type.items():
        rate = (d["redeemed"] / d["sent"] * 100) if d["sent"] else 0
        avg_discount = sum(d["discount_percents"]) / len(d["discount_percents"]) if d["discount_percents"] else 0
        summary.append({
            "offer_type": t,
            "codes_sent": d["sent"],
            "codes_redeemed": d["redeemed"],
            "redemption_rate_percent": round(rate, 1),
            "average_discount_percent": round(avg_discount, 1),
        })
    summary.sort(key=lambda r: r["redemption_rate_percent"], reverse=True)
    return {"by_offer_type": summary, "note": "redemption = the code appears on an actual paid bill's offer code field"}


def compute_pnl_income(data_dir, month=None):
    """Real Income figures for the Admin P&L: Net Salon Sales (service revenue,
    GST-adjusted the same way as Reports) and Product Sales Margin (profit
    only, from actual retail products sold on bills this month -- never the
    full sale value)."""
    if not month:
        month = datetime.datetime.now().strftime("%Y-%m")
    conn = connect(data_dir)
    bills = _load_table(conn, "bills")
    conn.close()
    month_bills = [b for b in bills if (b.get("date") or "")[:7] == month]

    net_salon_sales = sum(b.get("total", 0) or 0 for b in month_bills) * (1 - 0.047)

    product_margin = 0.0
    products_sold_count = 0
    for b in month_bills:
        for rp in (b.get("retailProducts") or []):
            qty = rp.get("quantity", 0) or 0
            margin_per_unit = (rp.get("salePrice", 0) or 0) - (rp.get("landingPrice", 0) or 0)
            product_margin += margin_per_unit * qty
            products_sold_count += qty

    return {
        "month": month,
        "netSalonSales": round(net_salon_sales),
        "productSalesMargin": round(product_margin),
        "productsSoldCount": products_sold_count,
        "billCount": len(month_bills),
    }


def tool_get_business_summary(data_dir, start_date=None, end_date=None):
    """A broad snapshot for advisory/strategic questions -- call this twice
    with different date ranges to compare trends (e.g. this month vs last)."""
    conn = connect(data_dir)
    start_dt, end_dt = _parse_date_range(start_date, end_date, default_days=30)
    all_bills = _load_table(conn, "bills")
    bills = [b for b in all_bills if start_dt <= _bill_dt(b) < end_dt]
    services = _load_table(conn, "services")
    services_by_id = {s["id"]: s for s in services}
    customers = _load_table(conn, "customers")
    enquiries = _load_table(conn, "enquiries")
    staff = _load_table(conn, "staff")
    conn.close()

    gross = sum((b.get("total", 0) + (b.get("productAmount", 0) or 0) + (b.get("makeupAdvance", 0) or 0)) for b in bills)
    net = gross * (1 - 0.047)
    total_bills = len(bills)
    unique_customers = len(set(b.get("customerId") for b in bills))
    premium_bills = sum(1 for b in bills if any(services_by_id.get(it.get("serviceId"), {}).get("category") == "Premium" for it in b.get("items", [])))
    premium_pct = (premium_bills / total_bills * 100) if total_bills else 0

    service_revenue = {}
    for b in bills:
        for it in b.get("items", []):
            svc = services_by_id.get(it.get("serviceId"))
            if svc:
                service_revenue[svc["name"]] = service_revenue.get(svc["name"], 0) + (it.get("price", 0) or 0)
    ranked_services = sorted(service_revenue.items(), key=lambda kv: kv[1], reverse=True)
    top_services = [{"service": n, "revenue_inr": round(r)} for n, r in ranked_services[:3]]
    bottom_services = [{"service": n, "revenue_inr": round(r)} for n, r in ranked_services[-3:]] if len(ranked_services) > 3 else []

    staff_revenue = {}
    for b in bills:
        for it in b.get("items", []):
            sid = _item_staff_id(it, b)
            staff_revenue[sid] = staff_revenue.get(sid, 0) + (it.get("price", 0) or 0)
    staff_by_id = {s["id"]: s for s in staff}
    ranked_staff = sorted(staff_revenue.items(), key=lambda kv: kv[1], reverse=True)
    top_staff = [{"staff": staff_by_id.get(sid, {}).get("name", "Unknown"), "revenue_inr": round(r)} for sid, r in ranked_staff[:3]]

    enquiries_in_range = [e for e in enquiries if e.get("date") and start_dt.date().isoformat() <= e["date"] <= end_dt.date().isoformat()]
    converted = sum(1 for e in enquiries_in_range if e.get("status") == "Converted")
    enquiry_conversion_pct = (converted / len(enquiries_in_range) * 100) if enquiries_in_range else None

    inactive_count = len(computeInactive_py(customers, all_bills, 45))

    return {
        "period": f"{start_dt.date().isoformat()} to {(end_dt - datetime.timedelta(days=1)).date().isoformat()}",
        "gross_sales_inr": round(gross),
        "net_sales_inr": round(net),
        "total_bills": total_bills,
        "unique_customers_served": unique_customers,
        "premium_conversion_percent": round(premium_pct, 1),
        "top_services_by_revenue": top_services,
        "lowest_services_by_revenue": bottom_services,
        "top_staff_by_revenue": top_staff,
        "enquiries_logged": len(enquiries_in_range),
        "enquiry_conversion_percent": round(enquiry_conversion_pct, 1) if enquiry_conversion_pct is not None else None,
        "customers_currently_inactive_45plus_days": inactive_count,
    }


def computeInactive_py(customers, bills, threshold_days):
    by_customer_last_visit = {}
    for b in bills:
        cid = b.get("customerId")
        d = b.get("date", "")
        if not cid:
            continue
        if cid not in by_customer_last_visit or d > by_customer_last_visit[cid]:
            by_customer_last_visit[cid] = d
    now = datetime.datetime.now(datetime.timezone.utc)
    inactive = []
    for c in customers:
        last = by_customer_last_visit.get(c["id"]) or c.get("joinDate")
        if not last:
            continue
        try:
            last_dt = datetime.datetime.fromisoformat(last.replace("Z", "+00:00"))
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=datetime.timezone.utc)
        except Exception:
            continue
        if (now - last_dt).days >= threshold_days:
            inactive.append(c)
    return inactive


TOOLS_SCHEMA = [
    {
        "name": "get_staff_report",
        "description": "Performance metrics for one staff member over a date range: revenue, bills, customers served, average bill value, premium-service conversion %, average service time vs standard, and the specific customers who did NOT get a premium upsell in this period. Defaults to the last 7 days if no dates given.",
        "input_schema": {
            "type": "object",
            "properties": {
                "staff_name": {"type": "string", "description": "Staff member's name, exact or partial"},
                "start_date": {"type": "string", "description": "YYYY-MM-DD, optional"},
                "end_date": {"type": "string", "description": "YYYY-MM-DD, optional"},
            },
            "required": ["staff_name"],
        },
    },
    {
        "name": "get_premium_services_by_staff",
        "description": "Lists premium-category services a given staff member has performed, with date, customer, and price. Optionally scoped to a date range; if no dates given, returns all time.",
        "input_schema": {
            "type": "object",
            "properties": {
                "staff_name": {"type": "string", "description": "Staff member's name, exact or partial"},
                "start_date": {"type": "string", "description": "YYYY-MM-DD, optional"},
                "end_date": {"type": "string", "description": "YYYY-MM-DD, optional"},
            },
            "required": ["staff_name"],
        },
    },
    {
        "name": "get_age_bracket_summary",
        "description": "Visit counts, revenue, and premium-service uptake broken down by customer age bracket (Under 25, 25-39, 40-54, 55+, Unknown).",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_enquiries",
        "description": "Lists customer enquiries (leads that haven't necessarily become a paid visit yet) with client name, phone, location, service interested, dates, source, and status. Filter by status and/or source.",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "description": "Optional exact lead status to filter by: 'Pending', 'Converted', or 'Closed'"},
                "source": {"type": "string", "description": "Optional exact source to filter by: 'In-Salon', 'JustDial', 'Phone', 'Whatsapp', or 'Instagram'"},
            },
        },
    },
    {
        "name": "list_staff",
        "description": "Lists all staff names and roles on file. Useful to check spelling or see who exists before calling other tools.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_services",
        "description": "Lists all services on file with their category and price.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_appointments",
        "description": "Lists booked appointments (name, phone, date/time, source, status). By default only shows upcoming, not-yet-happened appointments still marked Upcoming.",
        "input_schema": {
            "type": "object",
            "properties": {"upcoming_only": {"type": "boolean", "description": "Set false to include past/completed/cancelled appointments too. Defaults to true."}},
        },
    },
    {
        "name": "get_offer_code_performance",
        "description": "Compares offer codes actually sent (from Outreach: win-back and birthday codes) against real redemptions found on paid bills, broken down by offer type, with redemption rate and average discount. Use this to answer 'what offers work' with real evidence instead of guessing.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_business_summary",
        "description": "A broad snapshot of the salon's performance over a date range: gross/net sales, bills, unique customers, premium conversion %, top and lowest-revenue services, top staff by revenue, enquiry volume and conversion rate, and count of currently-inactive customers. This is the right tool for advisory/strategic questions -- call it once for a recent period and once for an earlier period of the same length to compare trends before giving recommendations. Defaults to the last 30 days if no dates given.",
        "input_schema": {
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": "YYYY-MM-DD, optional"},
                "end_date": {"type": "string", "description": "YYYY-MM-DD, optional"},
            },
        },
    },
]

TOOL_DISPATCH = {
    "get_staff_report": lambda data_dir, i: tool_get_staff_report(data_dir, i.get("staff_name"), i.get("start_date"), i.get("end_date")),
    "get_premium_services_by_staff": lambda data_dir, i: tool_get_premium_services_by_staff(data_dir, i.get("staff_name"), i.get("start_date"), i.get("end_date")),
    "get_age_bracket_summary": lambda data_dir, i: tool_get_age_bracket_summary(data_dir),
    "get_enquiries": lambda data_dir, i: tool_get_enquiries(data_dir, i.get("status"), i.get("source")),
    "list_staff": lambda data_dir, i: tool_list_staff(data_dir),
    "list_services": lambda data_dir, i: tool_list_services(data_dir),
    "get_appointments": lambda data_dir, i: tool_get_appointments(data_dir, i.get("upcoming_only", True)),
    "get_offer_code_performance": lambda data_dir, i: tool_get_offer_code_performance(data_dir),
    "get_business_summary": lambda data_dir, i: tool_get_business_summary(data_dir, i.get("start_date"), i.get("end_date")),
}


def execute_tool(data_dir, name, tool_input):
    fn = TOOL_DISPATCH.get(name)
    if not fn:
        return {"error": f"Unknown tool '{name}'"}
    try:
        return fn(data_dir, tool_input or {})
    except Exception as e:
        return {"error": str(e)}


def call_claude_api(api_key, messages, model=None):
    body = {
        "model": model or DEFAULT_MODEL,
        "max_tokens": 1024,
        "system": ASSISTANT_SYSTEM_PROMPT,
        "messages": messages,
        "tools": TOOLS_SCHEMA,
    }
    req = urllib.request.Request(
        ANTHROPIC_API_URL,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def run_assistant_conversation(data_dir, api_key, messages, model=None):
    """Runs the tool-use loop and returns (answer_text, updated_messages)."""
    messages = list(messages)
    for _ in range(MAX_TOOL_ITERATIONS):
        response = call_claude_api(api_key, messages, model)
        content = response.get("content", [])
        stop_reason = response.get("stop_reason")
        if stop_reason == "tool_use":
            messages.append({"role": "assistant", "content": content})
            tool_results = []
            for block in content:
                if block.get("type") == "tool_use":
                    result = execute_tool(data_dir, block["name"], block.get("input"))
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block["id"],
                        "content": json.dumps(result),
                    })
            messages.append({"role": "user", "content": tool_results})
            continue
        text = "".join(b.get("text", "") for b in content if b.get("type") == "text")
        return text or "I couldn't find an answer to that.", messages
    return "That took too many steps to answer -- try asking something more specific.", messages


# ---- Gemini (alternative provider) -----------------------------------
# Built against Google's Interactions API (v1beta/interactions), the
# currently-recommended way to do function calling per Google's own docs as
# of this writing -- NOT the older generateContent endpoint, which Google
# now labels legacy. This is a genuinely new, still-evolving API surface;
# if Google changes its contract again, the fix should be confined to the
# functions in this section.
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"


def gemini_tools_schema():
    """Converts our existing Anthropic-format TOOLS_SCHEMA into Gemini's
    function-declaration shape. Both use a JSON-Schema-shaped parameters
    object, so this is a straight field rename, computed once."""
    return [
        {"type": "function", "name": t["name"], "description": t["description"], "parameters": t["input_schema"]}
        for t in TOOLS_SCHEMA
    ]


GEMINI_TOOLS_SCHEMA = gemini_tools_schema()


def call_gemini_api(api_key, gemini_input, model=None):
    body = {
        "model": model or DEFAULT_GEMINI_MODEL,
        "system_instruction": ASSISTANT_SYSTEM_PROMPT,
        "input": gemini_input,
        "tools": GEMINI_TOOLS_SCHEMA,
        "store": False,  # we manage conversation history ourselves, same as the Claude path
    }
    req = urllib.request.Request(
        GEMINI_API_URL,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={"x-goog-api-key": api_key, "content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def run_gemini_assistant_conversation(data_dir, api_key, gemini_input, model=None):
    """Mirrors run_assistant_conversation's contract (returns answer_text,
    updated_history) but speaks Gemini's stateless Interactions API shape."""
    history = list(gemini_input)
    for _ in range(MAX_TOOL_ITERATIONS):
        response = call_gemini_api(api_key, history, model)
        steps = response.get("steps", []) or []
        history.extend(steps)
        function_call_steps = [s for s in steps if s.get("type") == "function_call"]
        if not function_call_steps:
            answer = response.get("output_text", "")
            return answer or "I couldn't find an answer to that.", history
        for fc in function_call_steps:
            result = execute_tool(data_dir, fc.get("name"), fc.get("arguments"))
            history.append({
                "type": "function_result",
                "name": fc.get("name"),
                "call_id": fc.get("id"),
                "result": [{"type": "text", "text": json.dumps(result)}],
            })
    return "That took too many steps to answer -- try asking something more specific.", history


# -------------------------------------------------------------- handlers --

class Handler(http.server.BaseHTTPRequestHandler):
    data_dir = None
    static_file = None
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # ---- helpers ----
    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status, message):
        self._send_json({"error": message}, status)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def _auth_user(self):
        token = self.headers.get("X-Auth-Token", "")
        if not token:
            return None
        return get_session_user(token)

    def _require_auth(self):
        user = self._auth_user()
        if not user:
            self._send_error_json(401, "Not logged in")
            return None
        return user

    def _require_admin(self):
        user = self._require_auth()
        if not user:
            return None
        conn = connect(self.data_dir)
        row = conn.execute("SELECT role FROM users WHERE username=?", (user,)).fetchone()
        conn.close()
        if not row or row["role"] != "admin":
            self._send_error_json(403, "Admin access required")
            return None
        return user

    # ---- routing ----
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/bootstrap-status":
            self._send_json({"needsSetup": not any_users_exist(self.data_dir)})
            return

        if path == "/api/all":
            if not self._require_auth():
                return
            self._send_json(self._load_all())
            return

        if path.startswith("/api/pnl"):
            if not self._require_admin():
                return
            qs = parse_qs(urlparse(self.path).query)
            month = (qs.get("month") or [None])[0]  # 'YYYY-MM'
            self._send_json(compute_pnl_income(self.data_dir, month))
            return

        if path == "/api/assistant/status":
            if not self._require_auth():
                return
            self._send_json({
                "configured": bool(get_api_key(self.data_dir)),  # kept for backward compatibility -- means "claude configured"
                "claudeConfigured": bool(get_api_key(self.data_dir)),
                "geminiConfigured": bool(get_gemini_api_key(self.data_dir)),
            })
            return

        if path == "/api/ping":
            self._send_json({"ok": True})
            return

        # static file (the bundled app)
        if path == "/" or path == "":
            self._serve_static()
            return

        self._send_error_json(404, "Not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_json_body()

        if path == "/api/setup":
            return self._handle_setup(body)
        if path == "/api/login":
            return self._handle_login(body)
        if path == "/api/logout":
            return self._handle_logout()
        if path == "/api/users":
            return self._handle_add_user(body)
        if path == "/api/backup":
            return self._handle_manual_backup()

        if path == "/api/assistant":
            return self._handle_assistant(body)

        for key, table in ENTITY_TABLES.items():
            if path == f"/api/{key}":
                return self._handle_create(table, body)

        self._send_error_json(404, "Not found")

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self._read_json_body()

        if path == "/api/settings":
            return self._handle_update_settings(body)

        for key, table in ENTITY_TABLES.items():
            prefix = f"/api/{key}/"
            if path.startswith(prefix):
                record_id = path[len(prefix):]
                return self._handle_update(table, record_id, body)

        self._send_error_json(404, "Not found")

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path

        for key, table in ENTITY_TABLES.items():
            prefix = f"/api/{key}/"
            if path.startswith(prefix):
                record_id = path[len(prefix):]
                return self._handle_delete(table, record_id)

        self._send_error_json(404, "Not found")

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    # ---- static ----
    def _serve_static(self):
        if not self.static_file or not os.path.exists(self.static_file):
            self._send_error_json(500, "App bundle not found on server")
            return
        with open(self.static_file, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---- auth handlers ----
    def _handle_setup(self, body):
        if any_users_exist(self.data_dir):
            self._send_error_json(403, "Setup already completed")
            return
        username = (body.get("username") or "").strip()
        password = body.get("password") or ""
        if not username or len(password) < 6:
            self._send_error_json(400, "Username required, password must be 6+ characters")
            return
        pw_hash, salt = hash_password(password)
        conn = connect(self.data_dir)
        with conn:
            conn.execute(
                "INSERT INTO users (username, password_hash, salt, created_at, role) VALUES (?, ?, ?, ?, 'owner')",
                (username, pw_hash, salt, now_iso()),
            )
        conn.close()
        token = create_session(username)
        self._send_json({"token": token, "username": username, "role": "owner"})

    def _handle_login(self, body):
        username = (body.get("username") or "").strip()
        password = body.get("password") or ""
        conn = connect(self.data_dir)
        row = conn.execute(
            "SELECT password_hash, salt, role FROM users WHERE username=?", (username,)
        ).fetchone()
        conn.close()
        if not row or not verify_password(password, row["salt"], row["password_hash"]):
            self._send_error_json(401, "Incorrect username or password")
            return
        token = create_session(username)
        self._send_json({"token": token, "username": username, "role": row["role"] or "staff"})

    def _handle_logout(self):
        token = self.headers.get("X-Auth-Token", "")
        with SESSIONS_LOCK:
            SESSIONS.pop(token, None)
        self._send_json({"ok": True})

    def _handle_add_user(self, body):
        if not self._require_auth():
            return
        username = (body.get("username") or "").strip()
        password = body.get("password") or ""
        role = body.get("role") or "staff"
        if role not in ("staff", "owner"):  # adding another admin isn't allowed via this endpoint
            role = "staff"
        if not username or len(password) < 6:
            self._send_error_json(400, "Username required, password must be 6+ characters")
            return
        pw_hash, salt = hash_password(password)
        conn = connect(self.data_dir)
        try:
            with conn:
                conn.execute(
                    "INSERT INTO users (username, password_hash, salt, created_at, role) VALUES (?, ?, ?, ?, ?)",
                    (username, pw_hash, salt, now_iso(), role),
                )
        except sqlite3.IntegrityError:
            self._send_error_json(409, "That username already exists")
            conn.close()
            return
        conn.close()
        self._send_json({"ok": True})

    # ---- data handlers ----
    def _load_all(self):
        conn = connect(self.data_dir)
        result = {}
        for key, table in ENTITY_TABLES.items():
            field = to_camel(table)
            rows = conn.execute(f"SELECT data FROM {table} ORDER BY updated_at ASC").fetchall()
            result[field] = [json.loads(r["data"]) for r in rows]
        row = conn.execute("SELECT value FROM settings WHERE key='settings'").fetchone()
        result["settings"] = json.loads(row["value"]) if row else dict(DEFAULT_SETTINGS)
        conn.close()
        return result

    def _handle_create(self, table, body):
        if not self._require_auth():
            return
        record_id = body.get("id") or str(uuid.uuid4())
        body["id"] = record_id
        conn = connect(self.data_dir)

        if table == "customers":
            with CUSTOMER_PHONE_LOCK:
                existing = _find_customer_by_phone(conn, body.get("phone"))
                if existing:
                    conn.close()
                    self._send_error_json(409, f"A customer with this phone number already exists: {existing.get('name')}")
                    return
                with conn:
                    conn.execute(
                        "INSERT OR REPLACE INTO customers (id, data, updated_at) VALUES (?, ?, ?)",
                        (record_id, json.dumps(body), now_iso()),
                    )
            conn.close()
            self._send_json(body, 201)
            return

        if table == "bills" and not body.get("invoiceNumber"):
            with INVOICE_COUNTER_LOCK:
                row = conn.execute("SELECT value FROM settings WHERE key='invoice_counter'").fetchone()
                counter = int(row["value"]) if row else 0
                counter += 1
                with conn:
                    conn.execute(
                        "INSERT OR REPLACE INTO settings (key, value) VALUES ('invoice_counter', ?)",
                        (str(counter),),
                    )
                body["invoiceNumber"] = f"INV-{counter:05d}"

        if table == "stock_entries" and not body.get("invoiceNumber"):
            with STOCK_INVOICE_LOCK:
                row = conn.execute("SELECT value FROM settings WHERE key='stock_invoice_counter'").fetchone()
                counter = int(row["value"]) if row else 0
                counter += 1
                with conn:
                    conn.execute(
                        "INSERT OR REPLACE INTO settings (key, value) VALUES ('stock_invoice_counter', ?)",
                        (str(counter),),
                    )
                body["invoiceNumber"] = f"INV-VEN-{counter:04d}"

        if table == "bills":
            retail_products = body.get("retailProducts") or []
            if retail_products:
                with STOCK_INVOICE_LOCK:
                    _apply_retail_stock_delta(conn, [], retail_products)
            linked_id = body.get("linkedMakeupBookingId")
            advance = body.get("makeupAdvance") or 0
            if linked_id and advance:
                with MAKEUP_ADVANCE_LOCK:
                    _apply_makeup_advance_delta(conn, None, 0, linked_id, advance)
        with conn:
            conn.execute(
                f"INSERT OR REPLACE INTO {table} (id, data, updated_at) VALUES (?, ?, ?)",
                (record_id, json.dumps(body), now_iso()),
            )
        conn.close()
        self._send_json(body, 201)

    def _handle_update(self, table, record_id, body):
        if not self._require_auth():
            return
        body["id"] = record_id
        conn = connect(self.data_dir)

        if table == "customers":
            with CUSTOMER_PHONE_LOCK:
                existing = _find_customer_by_phone(conn, body.get("phone"), exclude_id=record_id)
                if existing:
                    conn.close()
                    self._send_error_json(409, f"A customer with this phone number already exists: {existing.get('name')}")
                    return
                with conn:
                    conn.execute(
                        "INSERT OR REPLACE INTO customers (id, data, updated_at) VALUES (?, ?, ?)",
                        (record_id, json.dumps(body), now_iso()),
                    )
            conn.close()
            self._send_json(body)
            return

        if table == "bills":
            old_row = conn.execute("SELECT data FROM bills WHERE id=?", (record_id,)).fetchone()
            old_data = json.loads(old_row["data"]) if old_row else {}
            old_retail = old_data.get("retailProducts") or []
            new_retail = body.get("retailProducts") or []
            if old_retail or new_retail:
                with STOCK_INVOICE_LOCK:
                    _apply_retail_stock_delta(conn, old_retail, new_retail)
            old_linked_id = old_data.get("linkedMakeupBookingId")
            old_advance = old_data.get("makeupAdvance") or 0
            new_linked_id = body.get("linkedMakeupBookingId")
            new_advance = body.get("makeupAdvance") or 0
            if old_linked_id or new_linked_id:
                with MAKEUP_ADVANCE_LOCK:
                    _apply_makeup_advance_delta(conn, old_linked_id, old_advance, new_linked_id, new_advance)

        with conn:
            conn.execute(
                f"INSERT OR REPLACE INTO {table} (id, data, updated_at) VALUES (?, ?, ?)",
                (record_id, json.dumps(body), now_iso()),
            )
        conn.close()
        self._send_json(body)

    def _handle_delete(self, table, record_id):
        if not self._require_auth():
            return
        conn = connect(self.data_dir)
        if table == "bills":
            old_row = conn.execute("SELECT data FROM bills WHERE id=?", (record_id,)).fetchone()
            old_data = json.loads(old_row["data"]) if old_row else {}
            old_retail = old_data.get("retailProducts") or []
            if old_retail:
                with STOCK_INVOICE_LOCK:
                    _apply_retail_stock_delta(conn, old_retail, [])  # give the stock back
            old_linked_id = old_data.get("linkedMakeupBookingId")
            old_advance = old_data.get("makeupAdvance") or 0
            if old_linked_id and old_advance:
                with MAKEUP_ADVANCE_LOCK:
                    _apply_makeup_advance_delta(conn, old_linked_id, old_advance, None, 0)  # give the advance back
        with conn:
            conn.execute(f"DELETE FROM {table} WHERE id=?", (record_id,))
        conn.close()
        self._send_json({"ok": True})

    def _handle_update_settings(self, body):
        if not self._require_auth():
            return
        conn = connect(self.data_dir)
        row = conn.execute("SELECT value FROM settings WHERE key='settings'").fetchone()
        current = json.loads(row["value"]) if row else dict(DEFAULT_SETTINGS)
        current.update(body)
        with conn:
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('settings', ?)",
                (json.dumps(current),),
            )
        conn.close()
        self._send_json(current)

    def _handle_manual_backup(self):
        if not self._require_auth():
            return
        conn = connect(self.data_dir)
        write_backup(self.data_dir, conn)
        row = conn.execute("SELECT value FROM settings WHERE key='settings'").fetchone()
        settings = json.loads(row["value"]) if row else dict(DEFAULT_SETTINGS)
        settings["lastBackupISO"] = now_iso()
        with conn:
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('settings', ?)",
                (json.dumps(settings),),
            )
        conn.close()
        self._send_json({"ok": True, "backedUpAt": settings["lastBackupISO"]})

    def _handle_assistant(self, body):
        if not self._require_auth():
            return
        provider = body.get("provider") or "claude"
        user_message = body.get("message", "")
        if not user_message.strip():
            self._send_error_json(400, "Message is empty")
            return
        history = body.get("history") or []

        if provider == "gemini":
            api_key = get_gemini_api_key(self.data_dir)
            if not api_key:
                self._send_error_json(
                    400,
                    "The Gemini assistant isn't set up yet. Add your Gemini API key to "
                    "data/gemini-api-key.txt on the server, then restart it.",
                )
                return
            gemini_input = history + [{"type": "user_input", "content": [{"type": "text", "text": user_message}]}]
            try:
                answer, updated_history = run_gemini_assistant_conversation(self.data_dir, api_key, gemini_input, model=get_gemini_model(self.data_dir))
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", errors="replace")[:300]
                self._send_error_json(502, f"Gemini API error ({e.code}): {detail}")
                return
            except urllib.error.URLError as e:
                self._send_error_json(502, f"Could not reach Gemini's API: {e.reason}")
                return
            except Exception as e:
                self._send_error_json(500, f"Assistant error: {e}")
                return
            self._send_json({"answer": answer, "history": updated_history})
            return

        api_key = get_api_key(self.data_dir)
        if not api_key:
            self._send_error_json(
                400,
                "The AI assistant isn't set up yet. Add your Anthropic API key to "
                "data/anthropic-api-key.txt on the server, then restart it.",
            )
            return
        messages = history + [{"role": "user", "content": user_message}]
        try:
            answer, updated_messages = run_assistant_conversation(self.data_dir, api_key, messages)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:300]
            self._send_error_json(502, f"Anthropic API error ({e.code}): {detail}")
            return
        except urllib.error.URLError as e:
            self._send_error_json(502, f"Could not reach Anthropic's API: {e.reason}")
            return
        except Exception as e:
            self._send_error_json(500, f"Assistant error: {e}")
            return
        self._send_json({"answer": answer, "history": updated_messages})


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def background_backup_loop(data_dir):
    while True:
        try:
            maybe_run_daily_backup(data_dir)
        except Exception as e:
            print(f"Background backup check failed: {e}")
        time.sleep(6 * 60 * 60)  # re-check every 6 hours


def main():
    parser = argparse.ArgumentParser(description="Salon Manager server")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--data-dir",
        default=os.path.join(SCRIPT_DIR, "data"),
        help="Folder to store salon.db and backups in (default: ./data)",
    )
    parser.add_argument(
        "--static-file",
        default=os.path.join(SCRIPT_DIR, "salon-manager-remote.html"),
        help="Path to the bundled frontend HTML file to serve",
    )
    args = parser.parse_args()

    os.makedirs(args.data_dir, exist_ok=True)
    init_db(args.data_dir)

    Handler.data_dir = args.data_dir
    Handler.static_file = args.static_file

    threading.Thread(target=background_backup_loop, args=(args.data_dir,), daemon=True).start()

    server = ThreadingServer(("0.0.0.0", args.port), Handler)
    print("============================================")
    print("  Salon Manager server is running")
    print("============================================")
    print(f"  Data folder: {args.data_dir}")
    print(f"  Open on this computer: http://localhost:{args.port}/")
    print("  Other devices (same network or Tailscale) can use this")
    print("  computer's IP or Tailscale name instead of 'localhost'.")
    print("  Press Ctrl+C to stop.")
    print("============================================")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        server.shutdown()


if __name__ == "__main__":
    main()
