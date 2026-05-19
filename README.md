# Team IC Location Dashboard

A small website for up to 10 team ICs to send one-tap GPS check-ins, with an admin dashboard that shows the latest location for everyone.

## Run locally

```powershell
$env:ADMIN_PASSWORD="choose-a-strong-password"
npm start
```

Then open:

- Admin dashboard: http://localhost:3000
- IC private links: sign in as admin and copy the links from the `IC Links` section

For quick local testing, the fallback admin password is `change-me`. Set `ADMIN_PASSWORD` before real use.

The admin password is stored as a salted hash in:

```text
data/admin.json
```

If you start with the fallback password, the dashboard will ask you to change it after login.

## Run 24/7 on Vercel

Use Upstash Redis from the Vercel Marketplace for persistent online storage. This keeps IC links, admin password, sessions, latest locations, and history available even when Vercel functions restart.

1. Push or upload this project to Vercel.
2. In Vercel, add the Upstash Redis integration from Marketplace.
3. Make sure these environment variables exist in the Vercel project:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
ADMIN_PASSWORD
```

4. Deploy the project.
5. Open the Vercel URL and sign in as admin.

When deployed, IC links automatically use the hosted HTTPS domain, for example:

```text
https://your-project.vercel.app/ic.html?t=PRIVATE_TOKEN
```

If `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are missing, the app falls back to local JSON files. That is fine for testing, but not for 24/7 hosting.

## Edit the team list

Change IC names in:

```text
data/team.json
```

Each IC has a private `token`. Keep those tokens secret because they allow that IC to update their location.

For Vercel/Upstash, edit the team list before first deploy if possible. The first online run seeds Redis from the starter team in the server. If you need to reset the online team later, change `STORE_PREFIX` in Vercel environment variables to a new value, then redeploy.

## GPS note

GPS works on `localhost` for testing. Once hosted online, the site must use HTTPS or phone browsers will block location access.

## Alerts

The admin dashboard refreshes every 15 seconds. Press the `!` button to allow browser notifications and sound alerts when an IC sends a new update. ICs with no location, or a location older than 30 minutes, are highlighted as stale.
