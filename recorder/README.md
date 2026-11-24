# TTM flow recorder

Keeps 48 hours of order book heat and big trades (Bybit and Binance, spot and perp) so TTM LENS opens with history.
Deploy as its own Cloudflare Worker (separate from the ttm-terminal site worker). See the steps Claude gave in chat.

Stored slice values are order size in hundreds of dollars (v x 100 = USD). Price = id x step.
Endpoints: /health (is it connected), /hist?ex=bybit|binance&mkt=spot|perp&sym=BTC&hours=6
