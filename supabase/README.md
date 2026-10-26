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
