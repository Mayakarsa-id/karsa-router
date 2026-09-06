import { getCookie } from 'hono/cookie'
import { getDb } from './db-client'

export async function getCurrentUser(c: any): Promise<string | null> {
  const token = getCookie(c, 'session')
  if (!token) return null
  const db = getDb(c.env)
  const session = await db.execQuery('SELECT Username FROM Sessions WHERE Token = ? AND ExpiresAt > datetime("now")', token)
  return session.length > 0 ? (session[0] as any).Username : null
}
