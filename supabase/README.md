# TTM accounts setup (one time, about 10 minutes)

1. Create a free project at supabase.com.
2. SQL Editor -> New query -> paste `schema.sql` -> Run.
3. Authentication -> URL Configuration:
   - Site URL: `https://ttm-tradethemove.github.io/ttm-markets-terminal/crypto/`
   - Redirect URLs: add the same address.
4. Authentication -> Email Templates -> Magic Link: add the line `Or enter this code: {{ .Token }}` so members can sign in with a code too.
5. Project Settings -> API: copy the Project URL and the `anon` public key into `ttm_config.json` (the anon key is meant to be public; never put the service_role key anywhere).
6. Sign in once on the site, then run in the SQL Editor:
   `update public.ttm_profiles set is_admin = true where email = 'YOUR EMAIL';`
7. Open the site -> Admin. Charging is OFF by default, so everyone gets every feature free.

TradingView links: add them to `ttm_config.json`, for example
`"tradingview": [{"name":"TTM Indicator","url":"https://www.tradingview.com/script/...","desc":"What it does"}]`

## Plans (Free / Crypto / TradFi / Pro)

- Plans and locks are controlled from the **Admin** page (Crypto terminal, `#admin`), once you are an admin.
- **Plans on** is off by default: while off, everyone sees everything. Turn it on to apply the grid.
- **Require sign-in** puts a sign-in in front of the whole site.
- The grid sets, per section, which plans get it. Pro always has everything. "Reset to the planned defaults" restores the plan you specified.
- Set each member's plan in the Members list on the same page.
- Prices show as "Price to be confirmed" until you fill `plans` in `ttm_config.json` (monthly / annual per plan).
- Locks run in the browser. The site's files are public, so this is a convenience gate, not a security lock.
- If you already ran the old schema, re-run `schema.sql`; it widens the plan check to free / crypto / tradfi / pro. If it errors on existing rows, run: `update ttm_profiles set plan='crypto' where plan='member';` first.

## Usage tracking (hidden Usage dashboard)

1. In Supabase, open **SQL Editor -> New query**, paste the contents of `supabase/usage.sql`, and press Run.
2. Open the site, sign in as admin, go to **Admin**. The **Usage** area is at the bottom of that page.
3. It records anonymous events (pages opened, buttons clicked, features used, how long, which device) and never what people type. Admins, Do Not Track browsers, and any device with tracking turned off are not counted.
4. The data is kept until you press **Clear older than 90 days** or **Clear ALL usage data**. **Export CSV** downloads everything first.

## Usage firewall and account deletion

- `usage.sql` now includes a firewall: only well-formed events are accepted (fixed event names, ids, sizes), scripts and bots are refused, and floods are rate-limited per network address, per browser and overall. The address is only used as a one-way hash for the count and is not stored with events. Run it again if you already ran an earlier version; it is safe to repeat.
- Admin has a **Collect usage data** switch that pauses all tracking instantly. The Usage page leaves bot-like browsers out of the numbers.
- Run `supabase/delete-account.sql` once to enable **Delete my account** (on the account card) and the **Delete** button next to each member in Admin. Deleting removes the account and its cloud-saved data. Usage events are kept but detached from the person. The only admin cannot be deleted.
