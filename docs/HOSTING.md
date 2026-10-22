# Put the dashboard online (web app with "Sign in with Google")

This turns Whatsup into a normal website that you can open on **any computer or tablet**:
- You **sign in with Google**, and the app reads your calendar from your own account.
- You can **install it** so it opens in its own window, like an app.
- It's hosted for free on Cloudflare.

**Time:** about 30 minutes, once. Everything is done in a web browser, apart from one optional Terminal command.
**You need:** your Google account and a free Cloudflare account.

## How it works

```
 your browser ──► "Sign in with Google" ──► Google asks: allow Whatsup to see your calendars (read-only)?
      │                                                        │
      ▼                                                        ▼
 Whatsup (Cloudflare) ◄──── keeps you signed in (encrypted cookie) ── reads today's events
```

- **Who can get in:** only Google accounts on **your list** (`allowed_emails`). Anyone else is turned away, and their Google permission is revoked straight away.
- **What it can do:** read your calendars and your email address. It **can't change** anything, and it can't see your Gmail, Drive or photos.
- **Staying signed in:** each browser stays signed in for 6 months in an encrypted cookie. The page's own code can't read it.
  - **Sign out** in the app signs out that one device only. Your other devices stay signed in.
- **Your settings** (your list of accounts, calendar IDs, location, cameras) are stored as **encrypted secrets in Cloudflare**, not in the public GitHub repo.

---

## Part A — Put it on Cloudflare (5 min)

1. Sign up at <https://dash.cloudflare.com/sign-up> (free) and verify your email.
2. Go to **Workers & Pages → Create → Import a repository** (it may say *Connect to Git*).
3. Connect GitHub and pick **wackyclaude/whatsup**.
4. Settings:
   - **Project name:** `whatsup`
   - **Root directory:** `cloud` (under *Advanced* / *Build settings*)
   - **Deploy command:** leave as `npx wrangler deploy`
5. **Deploy.** You get an address like `https://whatsup.<your-name>.workers.dev`. **Copy it** — you need it in Part B.

If you open it now, it shows a sign-in page saying setup isn't finished. That's expected.

---

## Part B — Let it sign in with Google (10 min)

1. Go to <https://console.cloud.google.com> and sign in.
2. **Create a project:** project picker at the top → **New project** → name it `whatsup` → **Create**. Make sure it's selected.
3. **Turn on the Calendar API:** search for **Google Calendar API** → **Enable**.
4. **Describe your app:** search for **Google Auth Platform** → **Get started**.
   - App name: `Whatsup Family Dashboard`
   - Support email: your Gmail
   - Audience: **External**
   - Contact email: your Gmail
   - Agree → **Create**.
5. **Ask for calendar access only:** Google Auth Platform → **Data access** → **Add or remove scopes**.
   - Search `calendar.readonly`, tick **…/auth/calendar.readonly** (*See and download any calendar you can access*).
   - **Update** → **Save**.
6. **Create the sign-in client:** Google Auth Platform → **Clients** → **Create client**.
   - Application type: **Web application**, name: `Whatsup`.
   - **Authorized redirect URIs → Add URI:** your Cloudflare address plus `/auth/callback`, for example
     `https://whatsup.<your-name>.workers.dev/auth/callback`
   - **Create.** Copy the **Client ID** and the **Client secret** now. Google shows the secret only once.
7. **Fill in Branding**, so Google lets you publish: Google Auth Platform → **Branding**.
   - **App home page:** `https://whatsup.<your-name>.workers.dev/about.html`
   - **App privacy policy link:** `https://whatsup.<your-name>.workers.dev/privacy.html`
   - **App terms of service link:** `https://whatsup.<your-name>.workers.dev/terms.html`
   - **Authorized domains → Add domain:** `<your-name>.workers.dev` (without `whatsup.` in front)
   - **Developer contact information:** your Gmail
   - **Leave the App logo empty.** Adding a logo makes Google insist on a full review.
   - **Save.**
8. **Publish it, so you don't get signed out every week:** Google Auth Platform → **Audience** → **Publish app** → Confirm.
   - While an app is in *Testing*, Google ends its sign-ins after 7 days.
   - Published is fine for a personal app. Unreviewed ("unverified") apps can have up to 100 users, plenty for a family.

> **Can't publish yet?** You can still start: on **Audience → Test users → Add users**, add your Gmail (and your partner's).
> Everything works, but you'll need to sign in again every 7 days until the app is published.
>
> When you sign in, Google will say **"Google hasn't verified this app"**. That's normal for a
> personal app you made yourself. Click **Advanced → Go to Whatsup Family Dashboard**.
> Google then lists exactly what the app asks for: your calendars (read-only) and your email address.
>
> Teach the family this is OK **only** on your own `…workers.dev` address. Anywhere else, that warning is a reason to stop.

---

## Part C — Add the settings in Cloudflare (10 min)

### 1. Make a random session key

This key encrypts the sign-in cookie. Open **Terminal** on your Mac and run:

```bash
openssl rand -base64 32
```

Copy the line it prints. If you'd rather not use Terminal, a password manager's "generate password" (40+ characters) works too.

### 2. Choose which calendars show

**You don't need any calendar IDs.** The dashboard shows every calendar that's **ticked** in the left-hand list of [Google Calendar](https://calendar.google.com) for the signed-in person. That includes:
- your own events
- calendars shared with you, like the school calendar
- calendars you subscribed to by link
- holiday calendars

It uses the same names and colours as Google Calendar, and shows each event once, even if it's in two calendars.

- **To hide one on the dashboard** (say "Work"), add it to `hide_calendars` below. You can also untick it in Google Calendar.
- **To show one only as "Busy"**, add it to `busy_calendars`.
- Use the calendar's name as it appears in Google Calendar (capitals don't matter).

### 3. Add the four settings

In Cloudflare: your Worker → **Settings → Variables and Secrets → Add**:

| Name | Type | Value |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Text | Client ID from Part B |
| `GOOGLE_CLIENT_SECRET` | **Secret** | Client secret from Part B |
| `SESSION_SECRET` | **Secret** | the random key from step 1 |
| `WHATSUP_CONFIG` | **Secret** | your settings (below) |

`WHATSUP_CONFIG`. Change the email addresses, and keep the commas and quotes exactly:

```json
{
  "allowed_emails": ["you@gmail.com", "partner@gmail.com"],
  "hide_calendars": ["Work"],
  "busy_calendars": [],
  "location": { "name": "Groningen", "latitude": 53.2194, "longitude": 6.5665, "timezone": "Europe/Amsterdam" },
  "cameras": [
    { "name": "Golden Temple", "place": "Amritsar", "youtube_video_id": "" }
  ],
  "panchang": { "month_system": "purnimanta" },
  "camera_rotate_minutes": 10
}
```

- **Smallest working version:** `{ "allowed_emails": ["you@gmail.com"] }`. That shows all your ticked calendars, with Groningen weather.
- **Events you mark Private** in Google always show as "Busy".
- **Cameras:** open a live stream you trust on YouTube. The ID is the 11 characters after `v=` in the address. A camera with an empty ID is hidden.
- **Prefer a fixed list instead?** Replace the hide/busy lines with:
  `"calendars": [ { "name": "School", "calendar_id": "PASTE-ID", "color": "#5ED39A" } ]`
  - The Calendar ID is in Google Calendar → Settings → that calendar → **Integrate calendar**.
  - `"calendar_id": "primary"` means the signed-in person's own calendar.

Click **Deploy** (or *Save and deploy*).

---

## Part D — Sign in and install it (2 min per device)

1. Open `https://whatsup.<your-name>.workers.dev`.
2. Click **Sign in with Google**. Pick your account, click **Advanced → Go to…**, and tick the calendar permission → **Continue**.
3. You see the dashboard.

**Install it as an app:**

- **Chrome (any Mac, including the 2017 MacBook Pro):**
  - Click the **install icon** at the right end of the address bar.
  - Or use **⋮ menu → Cast, save and share → Install page as app…**
  - Whatsup then opens in its own window and appears in Launchpad and the Dock.
- **Safari 17 or newer (macOS Sonoma and later):** **File → Add to Dock**.
  - The 2017 MacBook Pro can't run Sonoma, so use Chrome there.
- **iPad / iPhone (Safari):** **Share → Add to Home Screen**.

For a wall-display feel, open the app and press **Control-Command-F** for full screen.

> **On a shared family computer:** signing in also signs that browser into your Google account.
> The dashboard doesn't need that afterwards. Once it shows, you can sign out of Google in that
> browser (avatar at google.com → *Sign out*), and the dashboard stays signed in.
> Or sign in from a separate browser profile used only for the dashboard.

---

## Everyday

| To… | Do this |
|---|---|
| Add a person who can sign in | Add their Gmail to `allowed_emails` in `WHATSUP_CONFIG` → Deploy |
| Remove a person | Remove them from `allowed_emails` → Deploy. They're signed out everywhere on their next page load |
| Show or hide a calendar | Tick or untick it in Google Calendar (or use `hide_calendars`) |
| Change location or cameras | Edit `WHATSUP_CONFIG` → Deploy |
| Sign one device out | **Sign out** (top right of the dashboard) |
| Sign everyone out at once | Change `SESSION_SECRET` to a new random value → Deploy |
| Lost a device / remove the app's access completely | <https://myaccount.google.com/permissions> → Whatsup → remove access (signs that account out everywhere) |
| Update to the latest version | Nothing. Cloudflare redeploys automatically when the repo changes |
| See errors | Cloudflare → Worker → **Logs** |

## If something goes wrong

- **The sign-in page says setup isn't finished** — it lists which of the four settings is missing.
- **Google says `redirect_uri_mismatch`** — the address in Part B step 6 must be exactly your Cloudflare address plus `/auth/callback`. Google can take a few minutes to pick up a change.
- **"That Google account isn't on this dashboard's list"** — add it to `allowed_emails` (lower-case is fine).
- **"Please tick the See your calendars box"** — sign in again and tick the calendar permission.
- **A calendar is missing** — make sure it's ticked in Google Calendar for the person who's signed in, and not in `hide_calendars`. Changes show within 15 minutes.
- **"not found in your Google account"** (only with a fixed `calendars` list) — the person signed in can't see that calendar, or the Calendar ID is wrong.
- **A subscribed (by-link) calendar is behind** — Google refreshes those itself, sometimes only once a day.
- **Top right says "Settings: …"** — something in `WHATSUP_CONFIG` needs fixing. For "not valid JSON", paste it into <https://jsonlint.com> to find the missing comma or quote.

## Undo / revoke

- **Remove the app's access to your Google account:** <https://myaccount.google.com/permissions> → Whatsup → *Delete all connections*.
- **Take the site offline:** Cloudflare → Worker → Settings → Delete.

## Protect the GitHub side

Cloudflare redeploys whatever is pushed to the repo's `main` branch.
- Turn on **two-factor authentication** for your GitHub account.
- Don't give others write access to the repo.
- In Cloudflare: Worker → **Settings → Build** → turn **off** builds for non-production branches.

## Costs

- **Cloudflare:** free. The free tier allows 100,000 requests a day, and one open dashboard uses about 1,000.
- **Google Calendar API and Open-Meteo weather:** free at this scale.
