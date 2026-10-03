import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto'
import { z } from 'zod'
const KeySchema = z
  .object({
    kty: z.literal('EC'),
    crv: z.literal('P-256'),
    x: z.string().max(100),
    y: z.string().max(100),
  })
  .strip()
const CompleteSchema = z
  .object({ id: z.string().max(100), signature: z.string().max(300), interactive: z.boolean() })
  .strict()
export type PairingApproval = (
  identity: string,
  origin: string,
  interactive: boolean,
) => Promise<boolean>
export function createPairing(approve: PairingApproval) {
  const challenges = new Map<
    string,
    { key: z.infer<typeof KeySchema>; nonce: string; origin: string; expires: number }
  >()
  const sessions = new Map<string, { origin: string; expires: number }>()
  let approving = false
  return {
    challenge(value: unknown, origin: string) {
      for (const [id, item] of challenges) if (item.expires < Date.now()) challenges.delete(id)
      if (challenges.size >= 30)
        throw new Error('Too many connection attempts. Try again in a minute.')
      const key = KeySchema.parse(value)
      const id = randomBytes(24).toString('base64url')
      const nonce = randomBytes(32).toString('base64url')
      challenges.set(id, { key, nonce, origin, expires: Date.now() + 120_000 })
      return { id, nonce }
    },
    async complete(value: unknown, origin: string) {
      const input = CompleteSchema.parse(value)
      const challenge = challenges.get(input.id)
      challenges.delete(input.id)
      if (!challenge || challenge.origin !== origin || challenge.expires < Date.now())
        throw new Error('Connection request expired. Try again.')
      const valid = verify(
        'sha256',
        Buffer.from(challenge.nonce),
        { key: createPublicKey({ key: challenge.key, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
        Buffer.from(input.signature, 'base64url'),
      )
      if (!valid) throw new Error('Could not verify this browser.')
      const identity = createHash('sha256').update(JSON.stringify(challenge.key)).digest('hex')
      if (approving) throw new Error('A connection request is already waiting in Foolscap Connect.')
      approving = true
      try {
        if (!(await approve(identity, origin, input.interactive)))
          throw new Error('Open Foolscap Connect and approve this browser to continue.')
      } finally {
        approving = false
      }
      for (const [token, session] of sessions)
        if (session.expires < Date.now()) sessions.delete(token)
      if (sessions.size >= 100) sessions.delete(sessions.keys().next().value!)
      const token = randomBytes(32).toString('base64url')
      sessions.set(token, { origin, expires: Date.now() + 8 * 60 * 60 * 1000 })
      return { token }
    },
    accepts(token: string, origin: string) {
      const session = sessions.get(token)
      return !!session && session.origin === origin && session.expires > Date.now()
    },
    revoke() {
      sessions.clear()
      challenges.clear()
    },
  }
}
