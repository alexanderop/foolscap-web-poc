import { z } from 'zod'
const BASE = 'http://127.0.0.1:43123'
const Challenge = z.object({ id: z.string(), nonce: z.string() })
async function keyPair(create: boolean): Promise<CryptoKeyPair | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('foolscap-connection', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('keys')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    const stored = await new Promise<CryptoKeyPair | undefined>((resolve, reject) => {
      const request = db.transaction('keys').objectStore('keys').get('browser')
      request.onsuccess = () => resolve(request.result as CryptoKeyPair | undefined)
      request.onerror = () => reject(request.error)
    })
    if (stored || !create) return stored
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'sign',
      'verify',
    ])
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('keys', 'readwrite')
      transaction.objectStore('keys').put(pair, 'browser')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    return pair
  } finally {
    db.close()
  }
}
export async function pairComputer(interactive: boolean, signal: AbortSignal, base = BASE) {
  const pair = await keyPair(interactive)
  if (!pair) return undefined
  async function post(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
      credentials: 'omit',
      cache: 'no-store',
    })
    const value: unknown = await response.json()
    if (!response.ok) throw new Error('Approve this browser in Foolscap Connect, then try again.')
    return value
  }
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const challenge = Challenge.parse(await post('/pair/challenge', publicKey))
  const bytes = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.privateKey,
    new TextEncoder().encode(challenge.nonce),
  )
  const signature = btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
  return z
    .object({ token: z.string() })
    .parse(await post('/pair/complete', { id: challenge.id, signature, interactive })).token
}
export const companionAddress = BASE
