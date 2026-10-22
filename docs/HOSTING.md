# Put the dashboard online

Use this to open the dashboard on **any computer**. It's hosted for free on Cloudflare and locked behind a sign-in.

**Time:** about 30–40 minutes, once.
**You need:** your Google account, a free Cloudflare account, and Google Chrome on each Mac.
**You don't need:** Terminal skills, Python, Node, or admin rights.

## How it fits together

```
Your Google Calendar ──(read-only, shared with a "robot" account)──┐
Open-Meteo weather ────────────────────────────────────────────────┤
                                                                   ▼
                        Cloudflare Worker  ── locked by Cloudflare Access sign-in
                                                                   │
                         any Mac / browser ◀──────────────────────┘
```

- **Calendar:** read with Google's Calendar API by a **robot account** (Google calls it a *service account*).
  - You share your family calendar with it as **read-only**. It can't see anything you don't share.
- **Sign-in:** **Cloudflare Access** decides who can open the page. Only email addresses you list get in.
  - You get in by typing a one-time code that Cloudflare emails you.
  - The Worker checks the sign-in again itself. If Access is ever switched off, the page locks instead of opening up.
- **Private settings:** your calendar ID, robot key, location and cameras are stored as **encrypted secrets in Cloudflare**.
  - None of it is in the GitHub repo, which is public.

---

## Part A — Google: create the robot account (10 min)

1. Go to <https://console.cloud.google.com> and sign in with your Google account.
2. **Create a project.** Click the project picker at the top → **New project** → name it `family-dashboard` → **Create**. Make sure it's selected.
3. **Turn on the Calendar API.** In the search bar type **Google Calendar API**, open it, click **Enable**.
4. **Create the robot account.**
   - Menu → **IAM & Admin → Service accounts** → **Create service account**.
   - Name: `whatsup-dashboard` → **Create and continue**.
   - Skip the optional role and access steps (it needs **no** roles) → **Done**.
5. **Download its key.**
   - Click the new account → **Keys** tab → **Add key → Create new key → JSON → Create**.
   - A `.json` file downloads. **Treat it like a password.** You'll paste it into Cloudflare in Part B, then delete it.
6. **Copy the robot's email address.** It's shown on the service accounts page and ends in `.iam.gserviceaccount.com`.

### Share your calendar with the robot

7. Open [Google Calendar](https://calendar.google.com) → gear → **Settings**.
8. On the left, click the calendar to show. Your own calendar is listed under your name.
9. **Share with specific people or groups** → **Add people** → paste the robot's email.
   - Permission: **See all event details** → **Send**.
   - Events you mark **Private** in Google still show only as "Busy".
10. Scroll to **Integrate calendar** and copy the **Calendar ID**.
    - For your main calendar, it's your Gmail address.
    - Other calendars look like `abc123@group.calendar.google.com`.

Repeat 8–10 for each family calendar you want on the screen. **Don't share work calendars.**

---

## Part B — Cloudflare: put it online (15 min)

### 1. Create a free account

Sign up at <https://dash.cloudflare.com/sign-up> and verify your email.

### 2. Deploy from GitHub

1. In the dashboard: **Workers & Pages → Create → Import a repository** (it may say *Connect to Git*).
2. Connect your GitHub account and pick **wackyclaude/whatsup**.
3. Settings:
   - **Project name:** `whatsup`
   - **Root directory:** `cloud` (under *Advanced* / *Build settings*)
   - **Deploy command:** leave as `npx wrangler deploy`
4. **Deploy.** After a minute you get an address like `https://whatsup.<your-name>.workers.dev`.

Opening it now shows *"This dashboard is locked until Cloudflare Access is set up."* That's expected: it stays locked until step 3.

### 3. Lock it with Cloudflare Access

1. Open the Worker → **Settings → Domains & Routes**.
2. Next to **workers.dev**, click **Enable Cloudflare Access**.
   - The first time, Cloudflare asks you to create a **Zero Trust team**. Pick a team name and choose the **Free** plan.
   - Cloudflare asks for payment details even on the Free plan, but you won't be charged.
3. A box appears with two values. Copy both somewhere for step 4:
   - **Team domain**, like `yourteam.cloudflareaccess.com`
   - **Audience (AUD)**, a long string of letters and numbers
4. Click **Manage Cloudflare Access** and edit the policy so **only your family** gets in:
   - **Include → Emails:** your Gmail address, and your partner's if wanted.
   - **Session duration:** the longest option, so screens don't ask for a code too often.
5. Save.

### 4. Add the settings

In the Worker → **Settings → Variables and Secrets → Add**, add these four:

| Name | Type | Value |
|---|---|---|
| `TEAM_DOMAIN` | Text | the Team domain from step 3 |
| `POLICY_AUD` | Text | the Audience (AUD) from step 3 |
| `GOOGLE_SERVICE_ACCOUNT` | **Secret** | the whole robot key file from Part A step 5. Open it in TextEdit, select all, copy, paste. |
| `WHATSUP_CONFIG` | **Secret** | your settings (template below) |

`WHATSUP_CONFIG` template. Replace the calendar ID, add a line per calendar, and keep the commas between entries:

```json
{
  "location": { "name": "Groningen", "latitude": 53.2194, "longitude": 6.5665, "timezone": "Europe/Amsterdam" },
  "calendars": [
    { "name": "Family", "calendar_id": "PASTE-CALENDAR-ID", "color": "#6AA9FF", "show_details": true }
  ],
  "cameras": [
    { "name": "Golden Temple", "place": "Amritsar", "youtube_video_id": "" }
  ],
  "panchang": { "month_system": "purnimanta" },
  "camera_rotate_minutes": 10
}
```

- **Colours** to pick from: `#6AA9FF` blue, `#5ED39A` green, `#FF9F43` orange, `#FF7A90` pink, `#B9A7FF` purple.
- **`show_details: false`** shows every event from that calendar as "Busy".
- **Cameras:** open the live stream on YouTube. The ID is the 11 characters after `v=` in the address. A camera with an empty ID is hidden.
- **`month_system`:** `purnimanta` (North India) or `amanta`.

Click **Deploy** (or *Save and deploy*). Then **delete the downloaded key file** and empty the Bin.

### 5. Open it

Go to `https://whatsup.<your-name>.workers.dev`.
1. Cloudflare asks for your email and sends a code.
2. Enter the code and you see the dashboard.

If something isn't set up right, the top-right corner says **Settings: …** with what's missing.

---

## Part C — show it on a Mac when it's idle (5 min per Mac)

A Mac screensaver can't show a sign-in page. Instead, a small helper opens the dashboard full-screen after a few idle minutes and closes it the moment someone touches the keyboard or mouse.

- It uses **its own Chrome profile**, so your normal browsing and Google sign-ins aren't involved.
- It doesn't open on a locked screen, or during **quiet hours** (default 22:00–07:00), so the display can sleep at night.

1. Install **Google Chrome** if the Mac doesn't have it.
2. On <https://github.com/wackyclaude/whatsup>: **Code → Download ZIP**. Unzip it.
3. Make a folder called **Apps** in your home folder and move the unzipped folder into it as **whatsup**.
   - Not Documents, Desktop or Downloads: macOS blocks background helpers there.
4. Open **Terminal** and run:

   ```bash
   bash ~/Apps/whatsup/scripts/idle/install.sh
   ```

   - Paste your dashboard address.
   - Choose the idle minutes and quiet hours (press Enter for the defaults).
5. A Chrome window opens. Sign in once with your email code, check the dashboard shows, then close the window.

That's it. To open it yourself any time (e.g. to switch cameras):

```bash
bash ~/Apps/whatsup/scripts/idle/open.sh
```

To turn it off: `bash ~/Apps/whatsup/scripts/idle/uninstall.sh`. Add `--purge` to also sign that Mac out.

> **Note:** the helper only shows a window. It doesn't lock the Mac. Keep macOS's own
> lock settings (System Settings → Lock Screen) as you want them.
> The live camera keeps the screen awake while it plays. Quiet hours are what let the display sleep at night.

---

## Everyday

| To… | Do this |
|---|---|
| Change calendars, location, cameras | Cloudflare → Worker → Settings → Variables and Secrets → edit `WHATSUP_CONFIG` → Deploy |
| Add or remove a person who can sign in | Cloudflare Zero Trust → Access → Applications → whatsup → Policies |
| Update to the latest version | Nothing — Cloudflare redeploys automatically when the GitHub repo changes |
| See errors | Cloudflare → Worker → **Logs** |

## If something goes wrong

- **"Settings: WHATSUP_CONFIG is not valid JSON"** — a comma or quote is missing. Paste it into <https://jsonlint.com> to find the spot.
- **"not shared with the dashboard's robot account yet"** — redo Part A steps 7–9 for that calendar. Check you copied the right Calendar ID.
- **"Google sign-in failed"** — the `GOOGLE_SERVICE_ACCOUNT` secret isn't the complete key file. Paste it again.
- **"Not authorised"** — you opened the page without signing in, or your email isn't in the Access policy.
- **The idle helper doesn't open** — look at `~/Library/Logs/whatsup/idle.log`.

## Undo / revoke access

- **Stop the robot reading a calendar:** remove it under that calendar's *Share with specific people*.
- **Kill the robot's key:** Google Cloud → Service accounts → whatsup-dashboard → Keys → delete.
- **Take the site offline:** Cloudflare → Worker → Settings → delete the Worker.

## Costs

- **Cloudflare:** a family dashboard stays well within the free tier, which allows 100,000 requests a day. Each open screen uses about 1,000.
- **Cloudflare Access:** free for small teams.
- **Google Calendar API and Open-Meteo:** free at this scale.
