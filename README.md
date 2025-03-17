# AP Daily Watcher

A Deno CLI that marks AP Daily videos as watched in AP Classroom by the unit.

## Usage

Run directly from GitHub (no installation required):

```bash
deno run --allow-net=apc-api-production.collegeboard.org:443 https://raw.githubusercontent.com/jeremy46231/ap-daily-watcher/main/main.ts
```

The script will:
1. Prompt for your AP Classroom bearer token
2. Show your available AP classes
3. Let you select which classes to process
4. For each class, let you select which units to process
5. Mark all AP Daily videos in the selected units as watched

## Getting Your Token

1. Go to [AP Classroom](https://apclassroom.collegeboard.org) and sign in
2. Make sure that you're on `apclassroom.collegeboard.org`
3. Run `localStorage.getItem('account_access_token')` in the devtools console
4. Copy the token into the script (with or without quotes)

## Optional environment variable

You can set your bearer token as an environment variable to skip the prompt. `.env` files are also supported. Make sure to pass the `--allow-env` (and maybe `--env-file`) flag to Deno.

```bash
export BEARER_TOKEN='your_token_here'
```

## License

MIT
