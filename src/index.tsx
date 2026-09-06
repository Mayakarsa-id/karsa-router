import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
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
  const publicPaths = ['/users/verify', '/users/qr', '/users']
  if (publicPaths.includes(c.req.path)) {
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
  
  await next()
})

// Root Redirect
app.get('/', (c) => c.redirect('/providers'))

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
  const keys = await db.execQuery('SELECT ProviderId FROM Keys WHERE APIKEY = ? AND IsActive = 1', apiKey)
  if (keys.length === 0) return c.json({ error: 'Invalid API Key' }, 401)

  const providerId = keys[0].ProviderId
  const providers = await db.execQuery('SELECT * FROM Providers WHERE ProviderId = ?', providerId)
  if (providers.length === 0) return c.json({ error: 'Provider not found' }, 404)

  const provider = providers[0]
  const targetUrl = c.req.url.replace('/ai/openai-compatible/v1', provider.BaseUrl)

  const response = await fetch(targetUrl, {
    method: c.req.method,
    headers: c.req.raw.headers,
    body: c.req.raw.body,
  })

  // Record usage
  await db.execRun('INSERT INTO Usages (APIKEY, InputToken, OutputToken) VALUES (?, ?, ?)', apiKey, 0, 0) // Placeholder for actual token counting

  return response
})

export default app
