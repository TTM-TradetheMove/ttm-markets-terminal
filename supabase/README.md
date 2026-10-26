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
