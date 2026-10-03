import { describe, expect, it } from 'vitest'
import { webcrypto } from 'node:crypto'
import { createPairing } from '../companion/pairing'
async function browser() {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ])
  return {
    publicKey: await webcrypto.subtle.exportKey('jwk', keys.publicKey),
    async sign(nonce: string) {
      return Buffer.from(
        await webcrypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          keys.privateKey,
          new TextEncoder().encode(nonce),
        ),
      ).toString('base64url')
    },
  }
}
describe('remembered browser connection', () => {
  it('requires native approval once, verifies possession, reconnects, and revokes sessions', async () => {
    const approved = new Set<string>()
    let prompts = 0
    const pairing = createPairing(async (key, origin, interactive) => {
      const id = origin + key
      if (approved.has(id)) return true
      if (!interactive) return false
      prompts++
      approved.add(id)
      return true
    })
    const writer = await browser()
    const origin = 'https://writer.example'
    const denied = pairing.challenge(writer.publicKey, origin)
    await expect(
      pairing.complete(
        { id: denied.id, signature: await writer.sign(denied.nonce), interactive: false },
        origin,
      ),
    ).rejects.toThrow('approve')
    const challenge = pairing.challenge(writer.publicKey, origin)
    const input = {
      id: challenge.id,
      signature: await writer.sign(challenge.nonce),
      interactive: true,
    }
    const { token } = await pairing.complete(input, origin)
    expect(pairing.accepts(token, origin)).toBe(true)
    expect(pairing.accepts(token, 'https://other.example')).toBe(false)
    await expect(pairing.complete(input, origin)).rejects.toThrow('expired')
    const reconnect = pairing.challenge(writer.publicKey, origin)
    await pairing.complete(
      { id: reconnect.id, signature: await writer.sign(reconnect.nonce), interactive: false },
      origin,
    )
    expect(prompts).toBe(1)
    pairing.revoke()
    expect(pairing.accepts(token, origin)).toBe(false)
  })
  it('rejects a signature made by a different browser without asking for approval', async () => {
    let prompted = false
    const pairing = createPairing(async () => {
      prompted = true
      return true
    })
    const owner = await browser()
    const attacker = await browser()
    const challenge = pairing.challenge(owner.publicKey, 'https://writer.example')
    await expect(
      pairing.complete(
        { id: challenge.id, signature: await attacker.sign(challenge.nonce), interactive: true },
        'https://writer.example',
      ),
    ).rejects.toThrow('verify')
    expect(prompted).toBe(false)
  })
})
