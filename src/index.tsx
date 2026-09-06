import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { DBServer } from './db'
import { getDb, Bindings } from './shared/db-client'

// Domain Modules
import usersModule from './modules/users'
import providersModule from './modules/providers'
import keysModule from './modules/keys'
import usagesModule from './modules/usages'

// Export DO class for Cloudflare bindings
export { DBServer }

const app = new Hono<{ Bindings: Bindings }>()

// Auth Middleware
app.use(async (c, next) => {
  const publicPaths = ['/users/verify', '/users', '/register']
  const allowedUnverified = ['/users/qr', '/users/verify', '/register', '/users/logout']
  if (c.req.path.startsWith('/ai/openai-compatible/v1/')) {
    await next()
    return
  }
  if (publicPaths.includes(c.req.path)) {
    // also need to check if user is logged in but not verified and trying to access /users dashboard
    const sessionToken = getCookie(c, 'session')
    if (sessionToken) {
      const dbTmp = getDb(c.env)
      const sess = await dbTmp.execQuery('SELECT Username FROM Sessions WHERE Token = ? AND ExpiresAt > datetime("now")', sessionToken)
      if (sess.length > 0) {
        const u = await dbTmp.execQuery('SELECT IsVerified FROM Users WHERE Username = ?', sess[0].Username)
        if (u.length > 0 && u[0].IsVerified !== 1 && c.req.path === '/users') {
          return c.redirect(`/users/qr?username=${encodeURIComponent(sess[0].Username)}`)
        }
      }
    }
    await next()
    return
  }

  const sessionToken = getCookie(c, 'session')
  if (!sessionToken) {
    return c.redirect('/users/verify')
  }

  const db = getDb(c.env)
  const session = await db.execQuery('SELECT * FROM Sessions WHERE Token = ? AND ExpiresAt > datetime("now")', sessionToken)

  if (session.length === 0) {
    return c.redirect('/users/verify')
  }

  const username = session[0].Username
  const userRows = await db.execQuery('SELECT IsVerified FROM Users WHERE Username = ?', username)
  const isVerified = userRows.length > 0 ? userRows[0].IsVerified : 0
  if (isVerified !== 1) {
    if (!allowedUnverified.includes(c.req.path) && !c.req.path.startsWith('/users/qr') && !c.req.path.startsWith('/users/verify')) {
      return c.redirect(`/users/qr?username=${encodeURIComponent(username)}`)
    }
  }

  await next()
})


// Root Redirect
app.get('/', (c) => c.redirect('/users'))

// Register Routes
app.get('/register', (c) => {
  return c.html(
    <html>
      <head>
        <title>Register</title>
        <style>{`body { font-family: system-ui; padding: 20px; } input { margin: 5px; padding: 5px; } button { padding: 10px; }`}</style>
      </head>
      <body>
        <h2>Register</h2>
        <form method="post" action="/register">
          <input name="Username" placeholder="Username" required />
          <button type="submit">Register</button>
        </form>
      </body>
    </html>
  )
})

app.post('/register', async (c) => {
  const { Username } = await c.req.parseBody()
  const username = Username as string
  const db = getDb(c.env)

  const existing = await db.execQuery('SELECT * FROM Users WHERE Username = ?', username)
  if (existing.length > 0) return c.redirect('/register?error=exists')

  // Generate a simple TOTP secret (base32)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let secret = ''
  const randomValues = crypto.getRandomValues(new Uint8Array(16))
  for (let i = 0; i < 16; i++) {
    secret += chars[randomValues[i] % chars.length]
  }

  await db.execRun('INSERT INTO Users (Username, TotpSecret) VALUES (?, ?)', username, secret)

  const apiKey = `sk-kr-${crypto.randomUUID().replace(/-/g, '')}`
  await db.execRun('UPDATE Users SET APIKEY = ? WHERE Username = ?', apiKey, username)

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 86400000).toISOString()
  await db.execRun('INSERT INTO Sessions (Token, Username, ExpiresAt) VALUES (?, ?, ?)', token, username, expiresAt)
  setCookie(c, 'session', token, { expires: new Date(expiresAt), httpOnly: true, path: '/' })

  return c.redirect(`/users/qr?username=${encodeURIComponent(username)}`)
})

// Mount Modular Routes
app.route('/users', usersModule)
app.route('/providers', providersModule)
app.route('/keys', keysModule)
app.route('/usages', usagesModule)

// AI Proxy Route
app.all('/ai/openai-compatible/v1/*', async (c) => {
  const apiKey = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!apiKey) return c.json({ error: 'Unauthorized' }, 401)

  const db = getDb(c.env)
  // Check if API key belongs to a user
  const users = await db.execQuery('SELECT Username, IsVerified FROM Users WHERE APIKEY = ?', apiKey)
  if (users.length === 0) return c.json({ error: 'Invalid API Key' }, 401)
  if (users[0].IsVerified !== 1) return c.json({ error: 'User not verified' }, 403)
  const username = users[0].Username
  const providers = await db.execQuery('SELECT * FROM Providers WHERE Username = ?', username)
  if (providers.length === 0) return c.json({ error: 'Provider not found for user' }, 404)

  if (c.req.path.endsWith('/models')) {
    const results = await Promise.allSettled(
      providers.map(async (p) => {
        const url = `${p.BaseUrl.replace(/\/$/, '')}/models`
        const response = await fetch(url, { headers: c.req.raw.headers })
        if (!response.ok) throw new Error(`Failed to fetch models from ${p.Label}`)
        const data = await response.json()
        return (data as any).data.map((m: any) => ({
          ...m,
          id: `${p.Prefix}/${m.id}`,
        }))
      })
    )
    console.log(results);

    const allModels = results
      .filter((r) => r.status === 'fulfilled')
      .flatMap((r) => (r as PromiseFulfilledResult<any>).value)

    return c.json({ data: allModels })
  }

  // Existing Proxy logic
  const provider = providers[0] // Default to first for now
  const targetUrl = c.req.url.replace(/^.*?\/ai\/openai-compatible\/v1\//, `${provider.BaseUrl.replace(/\/$/, '')}/`)

  const response = await fetch(targetUrl, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
  })

  await db.execRun('INSERT INTO Usages (APIKEY, InputToken, OutputToken) VALUES (?, ?, ?)', apiKey, 0, 0)

  return response
})

export default app
