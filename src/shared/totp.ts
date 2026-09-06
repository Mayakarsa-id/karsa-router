export function generateBase32Secret(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let secret = ''
  const randomValues = crypto.getRandomValues(new Uint8Array(length))
  for (let i = 0; i < length; i++) {
    secret += chars[randomValues[i] % chars.length]
  }
  return secret
}

export function base32ToBuffer(base32: string): Uint8Array {
  const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (let i = 0; i < base32.length; i++) {
    const val = base32chars.indexOf(base32.charAt(i).toUpperCase())
    bits += val.toString(2).padStart(5, '0')
  }
  const buffer = new Uint8Array(Math.floor(bits.length / 8))
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = parseInt(bits.substring(i * 8, i * 8 + 8), 2)
  }
  return buffer
}

export async function verifyTOTP(secret: string, code: string): Promise<boolean> {
  const keyBuffer = base32ToBuffer(secret)
  const key = await crypto.subtle.importKey('raw', keyBuffer, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const timeStep = Math.floor(Date.now() / 30000)
  for (let offset = -1; offset <= 1; offset++) {
    const step = timeStep + offset
    const counterBuffer = new ArrayBuffer(8)
    const counterView = new DataView(counterBuffer)
    counterView.setUint32(4, step, false)
    const signature = await crypto.subtle.sign('HMAC', key, counterBuffer)
    const hash = new Uint8Array(signature)
    const offsetByte = hash[19] & 0xf
    const otp = (((hash[offsetByte] & 0x7f) << 24) | ((hash[offsetByte + 1] & 0xff) << 16) | ((hash[offsetByte + 2] & 0xff) << 8) | (hash[offsetByte + 3] & 0xff)) % 1000000
    if (otp.toString().padStart(6, '0') === code.trim()) return true
  }
  return false
}
