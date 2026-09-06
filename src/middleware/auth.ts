import { getCookie } from 'hono/cookie'
import { getDb, Bindings } from '../shared/db-client'
import type { MiddlewareHandler } from 'hono'

export const authMiddleware: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const publicPaths = ['/users/verify', '/users', '/register']
  const allowedUnverified = ['/users/qr', '/users/verify', '/register', '/users/logout']
  if (c.req.path.startsWith('/ai/openai-compatible/v1/')) {
    await next()
    return
  }
  if (publicPaths.includes(c.req.path)) {
    const sessionToken = getCookie(c, 'session')
    if (sessionToken) {
      const dbTmp = getDb(c.env)
      const sess = await dbTmp.execQuery('SELECT Username FROM Sessions WHERE Token = ? AND ExpiresAt > datetime("now")', sessionToken)
      if (sess.length > 0) {
        const u = await dbTmp.execQuery('SELECT IsVerified FROM Users WHERE Username = ?', (sess[0] as any).Username)
        if (u.length > 0 && (u[0] as any).IsVerified !== 1 && c.req.path === '/users') {
          return c.redirect(`/users/qr?username=${encodeURIComponent((sess[0] as any).Username)}`)
        }
      }
    }
    await next()
    return
  }

  const sessionToken = getCookie(c, 'session')
  if (!sessionToken) return c.redirect('/users/verify')

  const db = getDb(c.env)
  const session = await db.execQuery('SELECT * FROM Sessions WHERE Token = ? AND ExpiresAt > datetime("now")', sessionToken)
  if (session.length === 0) return c.redirect('/users/verify')

  const username = (session[0] as any).Username
  const userRows = await db.execQuery('SELECT IsVerified FROM Users WHERE Username = ?', username)
  const isVerified = userRows.length > 0 ? (userRows[0] as any).IsVerified : 0
  if (isVerified !== 1) {
    if (!allowedUnverified.includes(c.req.path) && !c.req.path.startsWith('/users/qr') && !c.req.path.startsWith('/users/verify')) {
      return c.redirect(`/users/qr?username=${encodeURIComponent(username)}`)
    }
  }
  await next()
}
