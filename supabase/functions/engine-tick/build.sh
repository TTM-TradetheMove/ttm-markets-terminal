#!/bin/bash
# Builds the single file for the Supabase dashboard editor: index.ts = logic.ts + main.ts joined.
cd "$(dirname "$0")"
{
echo "// TTM Automated Trading Engine (paper trading). Single file for the Supabase dashboard editor. Keep Verify JWT OFF."
echo "// Secrets: ANTHROPIC_API_KEY and ENGINE_KEY. Runs every 5 minutes (see engine2.sql)."
echo 'import webpush from "npm:web-push@3.6.7";'
sed 's/^export //' logic.ts
grep -v '^import ' main.ts
} > index.ts
