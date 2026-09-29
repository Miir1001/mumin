# Self-hosted n8n (unlimited executions)

Runs the free n8n Community Edition on your own server. There are no execution limits and no trial.

## 1. Save your workflow from n8n Cloud (do this before the trial ends)
- Open the workflow → **⋯** menu → **Download**. This saves a `.json` file.
- Open **Overview → Data tables**, open the table used by "Keep Only New Vacancies" and export it as CSV.
  Without it, vacancies you already posted get posted again.

## 2. Get a free server that stays on
Oracle Cloud "Always Free" works: create an Ubuntu VM (the Ampere A1 shape is free).
Any VPS or a computer that is always on works too.

## 3. Install
```bash
git clone <this repo> && cd <repo>/n8n-selfhost
./install.sh
```

## 4. Open n8n
On your own computer:
```bash
ssh -L 5678:localhost:5678 ubuntu@<server-ip>
```
Keep that window open and go to http://localhost:5678. Create your owner account.

## 5. Bring the workflow back
1. **Workflows → Import from file**, choose the downloaded `.json`.
2. Open the Telegram node and create a new credential with your bot token.
3. Create the data table again and import the CSV. Point both data table nodes at it.
4. Click **Execute workflow** once to test, then switch the workflow to **Active** (Publish).

It now runs every 15 minutes, 24/7, even when your laptop is off.

## Updating n8n
```bash
docker compose pull && docker compose up -d
```
