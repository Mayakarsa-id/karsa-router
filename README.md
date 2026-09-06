# Karsa Router

OpenAI-compatible router on Cloudflare Workers with Durable Object SQLite. Route by `prefix/model`, fallback across provider keys and `combo` multi-model chains, per-provider timeout, TOTP-secured auth, and brutalism UI with dark mode.

> Author: **navetacandra** <dev@navetacandraa.my.id> — MIT License

## Features
- **Auth**: Register → QR TOTP → Verify (`IsVerified`), cookie `session`, per-user `sk-kr-` API key
- **Providers**: `Prefix` (reserved `combo`), `Label`, `BaseUrl`, `Type` (openai/anthropic), `TimeoutMs` (1000–120000)
- **Keys**: Multiple `Keys` per `Provider` with `IsActive` fallback on non-2xx / timeout
- **Combos**: `Combos (ComboId, Username, Name)` + `ComboModels (ComboId, ProviderId, ModelId, Position)` — `combo/NAME` fallback chain
- **Proxy**: `POST /ai/openai-compatible/v1/*` with `Authorization: Bearer sk-kr-...`
  - `GET /models` aggregates `Prefix/id` + `combo/*` synthetic models
  - `POST /chat/completions` strips prefix (`openai/gpt-4o-mini` → `gpt-4o-mini`), tries keys sequentially, logs `Usages`
- **Usage**: Regex `"(prompt|completion|reasoning|cached)_tokens"` → `Input/Output/Cached` + `RequestCount` per `Users`, `Usages (Provider, Model, CachedToken)` table
- **UI**: `src/style.css` brutalism minimal, `dark` toggle (system + `localStorage`), dashboard stats `|Request|Input|Cached|Output|` and 10 newest logs with local timezone

## Stack
`Hono ^4.13.7` · `Cloudflare Workers DurableObject` (`DBServer`) · `Vite ^8.1.4` · `Wrangler ^4.110.0`

## Quick Start
```txt
pnpm install
pnpm run dev
```

Wrangler deploy:
```txt
pnpm run deploy
```

Types:
```txt
pnpm run cf-typegen
```

## API Examples
```bash
# models (user key)
curl -H "Authorization: Bearer sk-kr-..." http://localhost:5173/ai/openai-compatible/v1/models

# chat — single provider by prefix
curl -X POST http://localhost:5173/ai/openai-compatible/v1/chat/completions \
  -H "Authorization: Bearer sk-kr-..." -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'

# chat — combo fallback
curl -X POST http://localhost:5173/ai/openai-compatible/v1/chat/completions \
  -H "Authorization: Bearer sk-kr-..." -H "Content-Type: application/json" \
  -d '{"model":"combo/fast","messages":[{"role":"user","content":"hi"}],"stream":true}'
```

## Project Structure
```
src/db.ts                     # DurableObject schema + migrations
src/shared/{db-client,layout,auth,totp}.ts
src/middleware/auth.ts        # session + IsVerified gate
src/routes/{register,ai/index} # ai → utils/models/chat/{combo,single}
src/modules/{users,providers,combos}
src/style.css                 # brutalism + dark theme
wrangler.jsonc                # durable_objects DB / migrations
```

## License
MIT © navetacandra <dev@navetacandraa.my.id> — see [LICENSE](./LICENSE)
