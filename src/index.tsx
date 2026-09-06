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
app.get('/', (c) => c.redirect('/users'))

// Mount Modular Routes
app.route('/users', usersModule)
app.route('/providers', providersModule)
app.route('/keys', keysModule)
app.route('/usages', usagesModule)

export default app
