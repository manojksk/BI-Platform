# Salon Manager — Complete Setup & Daily Use Guide

## What you'll end up with

One computer — your reception desk computer — runs the app and holds all
the real data. Everyone else (you, your wife, your manager) just opens a
web page on their phone or computer to use it. Nothing is installed on the
phones themselves; there's no app store download for Salon Manager itself.

These instructions assume the server computer runs **Windows** (matching
what you've been using) and that phones are **Android**. Mac/Linux
equivalents exist too — ask if you need those spelled out the same way.

---

## PART 1 — One-Time Setup (Server Computer)

Do this once, on the reception desk computer.

### 1.1 Get the files onto the computer

If you already pushed the project to GitLab:
1. Open a browser, go to your GitLab project.
2. Click the blue **Code** button → **Download → zip**.
3. Once downloaded, right-click the zip file → **Extract All** → choose a
   permanent location, e.g. `C:\SalonManager`.

(If you're using the zip I gave you directly instead of GitLab, same idea —
extract it to `C:\SalonManager`.)

### 1.2 Check what's missing

1. Open the `C:\SalonManager` folder in File Explorer.
2. Double-click **`check-prerequisites-windows.bat`**.
3. A black window opens and prints a checklist. Read it — it clearly says
   `OK:` or `MISSING:` for each item (Python, the app files, the port).

### 1.3 Install Python, if the check said it's missing

1. In the same folder, double-click **`install-python-windows.bat`**.
2. It installs Python automatically. You may see a Windows security prompt
   — click **Yes** to allow it.
3. **Close the black window completely**, then reopen
   `check-prerequisites-windows.bat` again to confirm it now says `OK` for
   Python. (This second run matters — Windows only recognizes the new
   installation in a fresh window.)

### 1.4 Start the server for the first time

1. Double-click **`start-server-windows.bat`**.
2. A black window opens and stays open, ending with a line like
   `Serving...` / `Salon Manager server is running`. Leave this window
   open — closing it turns the app off for everyone.
3. Open **Google Chrome** on the same computer and go to:
   ```
   http://localhost:8765/
   ```
4. You'll see a page titled **"Set Up This Salon."**

### 1.5 Create your own login

1. On that setup page, fill in:
   - **Username** — anything you'll remember, e.g. `manoj`
   - **Password** — at least 6 characters
   - **Confirm Password** — same again
2. Click **Create Account & Continue**.
3. You're now looking at the Dashboard — you're in.

### 1.6 Add logins for your wife and your manager

1. Click **Backup** in the left menu.
2. Under **Team Access**, enter a username and password for your wife,
   click **Add Login**. Repeat for your manager.
3. Tell each of them their own username and password (share it directly,
   not by leaving it written down at reception).

**That's the entire one-time setup.** Everything from here on is routine.

---

## PART 2 — Every Day: Starting the Server

The server needs to be running for anyone — including you, on the same
computer — to use the app. Do this each morning:

1. Go to `C:\SalonManager`.
2. Double-click **`start-server-windows.bat`**.
3. Wait for the black window to show `Serving...` — that means it's ready.
4. **Leave that window open** in the background all day. Minimize it if
   you like, just don't close it.

**At closing time:** you can close that black window, or just leave the
computer on — either is fine. Your data is saved to disk continuously, not
just when you close the app, so there's no "shut down safely" step needed.

**Tip:** right-click `start-server-windows.bat` → **Create shortcut**, then
drag that shortcut onto the Desktop, so you don't need to dig into the
folder every morning.

---

## PART 3 — Using It on the Server Computer Itself

Once the server's running (Part 2), just open Chrome and go to:
```
http://localhost:8765/
```
Log in with your username and password. Bookmark this page for next time.

---

## PART 4 — Using It on a Phone, on the Salon's WiFi

This works immediately, no extra installs needed, as long as the phone is
connected to the **same WiFi** as the reception computer.

### 4.1 Find the reception computer's WiFi address

On the reception computer:
1. Press the **Windows key**, type `cmd`, press Enter.
2. Type `ipconfig` and press Enter.
3. Look for **"IPv4 Address"** — it looks like `192.168.1.42`. Write it down.

### 4.2 Open it on the phone

1. Make sure the phone's WiFi is connected to the salon's network.
2. Open **Chrome** on the phone.
3. Type in the address bar (using the number from step 4.1):
   ```
   http://192.168.1.42:8765/
   ```
4. Log in with that person's own username and password.

### 4.3 Add a shortcut icon to the home screen

1. In Chrome on the phone, tap the **⋮** menu (top right).
2. Tap **Add to Home screen** → **Add**.
3. A "Salon Manager" icon now sits on the home screen like any other app.
   Tapping it jumps straight to the login page (WiFi must still be
   connected to the salon network for this version).

---

## PART 5 — Using It on a Phone, From Anywhere (Not Just Salon WiFi)

This is the part that lets your wife or manager check things from home.
It uses **Tailscale** — a free app that privately and securely connects
just your own devices together over the internet, without exposing
anything to the public. Set this up once per device.

### 5.1 Install Tailscale on the reception computer

1. On the reception computer, open a browser and go to:
   ```
   https://tailscale.com/download
   ```
2. Download and run the Windows installer.
3. It opens a browser window asking you to sign in — use a Google account,
   Microsoft account, or email, whichever is easiest for you. This creates
   your private network.
4. Once signed in, Tailscale runs quietly in the background (look for its
   icon near the clock, bottom-right of the screen).

### 5.2 Find this computer's Tailscale address

1. Click the Tailscale icon near the clock.
2. It shows this computer's name and an address starting with `100.` —
   write that down (e.g. `100.87.12.4`). Alternatively it may show a name
   like `desktop-abc123.tailXXXXX.ts.net` — either works the same way.

### 5.3 Install Tailscale on each phone

1. On the phone, open the **Play Store**, search **Tailscale**, install it.
2. Open the app, sign in with the **exact same account** you used on the
   computer in step 5.1 (same Google/Microsoft/email).
3. Approve the connection request if asked.

### 5.4 Open the app from the phone, anywhere

1. On the phone, open **Chrome**.
2. Go to (using the address from step 5.2):
   ```
   http://100.87.12.4:8765/
   ```
3. Log in with that person's username and password.
4. This now works whether the phone is on the salon WiFi, at home, or on
   mobile data — anywhere with an internet connection.

### 5.5 Add a shortcut icon to the home screen (Tailscale version)

Same as step 4.3 — Chrome menu (**⋮**) → **Add to Home screen**. Since this
URL uses the Tailscale address, this icon will work from anywhere, not just
the salon.

**Note:** the reception computer must be powered on, connected to the
internet, and running `start-server-windows.bat` for remote access to work
— it's still the one actually holding the data.

---

## PART 6 — Quick Reference Card (for your wife / manager)

Print or screenshot this section for them — they don't need Parts 1, 2, or 5.

1. Open **Chrome** on your phone.
2. Tap the **Salon Manager** icon on your home screen (or go to the address
   Manoj gave you).
3. Enter your username and password.
4. Use the app as normal. Log out from the left-hand menu when you're done
   on a shared or borrowed device.
5. If it won't load: check you're either on the salon WiFi, or that
   Tailscale is turned on in your phone's app list, and that the reception
   computer's server is running.

---

## PART 7 — Troubleshooting

| Problem | Fix |
|---|---|
| Black server window shows an error and closes immediately | Run `check-prerequisites-windows.bat` first and fix anything marked `MISSING`. |
| Phone can't reach the page at all | Confirm the black server window is still open on the reception computer. Confirm the phone is on the salon WiFi (Part 4) or signed into Tailscale with the same account (Part 5). |
| "This site can't be reached" on the phone | Double check the address — it must start with `http://` (not `https://`) and end with `:8765/`, including the colon and numbers. |
| "Address already in use" when starting the server | Something else is using port 8765. Open `start-server-windows.bat` in Notepad, change `8765` to `8766` in the last line, save, and use `:8766` in every address from then on. |
| Forgot a password | Have someone who's already logged in go to Backup → Team Access and add you again (usernames must be unique, so pick a slightly different one if needed). |
| Need to restart the reception computer | Fine to do — just remember to double-click `start-server-windows.bat` again afterwards, since the server doesn't start itself automatically. |
