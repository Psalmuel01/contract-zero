import { describe, expect, it, vi } from 'vitest'
import { KeyPair, KeyPairSigner, actions, createTransaction, PublicKey } from 'near-api-js'

// Privy's SDK isn't loaded in tests; the signer only needs its signRawHash.
vi.mock('@privy-io/react-auth', () => ({ PrivyProvider: () => null, getAccessToken: async () => null, useLogin: () => ({}), useLogout: () => ({}), usePrivy: () => ({}) }))
vi.mock('@privy-io/react-auth/extended-chains', () => ({ useCreateWallet: () => ({}), useSignRawHash: () => ({}) }))

import { PrivySigner, __setHooksForTest } from '../privy'

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

// Privy signs the 32-byte hash with the wallet's ed25519 key; a local key stands in.
function fakePrivy(key: KeyPair, seen: string[]) {
  __setHooksForTest({
    ready: true, authenticated: true, user: null, login: () => {}, logout: async () => {},
    createWallet: (async () => { throw new Error('unused') }) as never,
    signRawHash: (async ({ hash, address, chainType }: { hash: string; address: string; chainType: string }) => {
      seen.push(`${chainType}:${address}:${hash.length}`)
      const bytes = Uint8Array.from(hash.slice(2).match(/../g)!, (x) => parseInt(x, 16))
      return { signature: `0x${hex(key.sign(bytes).signature)}` }
    }) as never,
  })
}

describe('the email (Privy) signer', () => {
  const key = KeyPair.fromRandom('ed25519')
  const account = hex(key.getPublicKey().data)

  it('signs the sign-in challenge exactly as a wallet key would (the server already verifies those)', async () => {
    const seen: string[] = []
    fakePrivy(key, seen)
    const msg = { message: 'Sign in to CONTRACT ZERO', recipient: 'contract-zero', nonce: new Uint8Array(32).fill(7) }
    const privy = await new PrivySigner(account).signNep413Message(account, msg)
    const local = await new KeyPairSigner(key).signNep413Message(account, msg)
    expect(Array.from(privy.signature)).toEqual(Array.from(local.signature))
    expect(privy.publicKey.toString()).toBe(key.getPublicKey().toString())
    expect(seen).toEqual([`near:${account}:66`]) // a 32-byte hash, as 0x-hex
  })

  it('signs transactions identically too (trades, quick-trade setup)', async () => {
    fakePrivy(key, [])
    const tx = createTransaction(account, key.getPublicKey() as PublicKey, 'world2.contract-zero.testnet', 5n, [actions.functionCall('accept_offer', { id: '1' }, 30_000_000_000_000n, 0n)], new Uint8Array(32))
    const a = await new PrivySigner(account).signTransaction(tx)
    const b = await new KeyPairSigner(key).signTransaction(tx)
    const sa = a.signedTransaction.signature.ed25519Signature?.data, sb = b.signedTransaction.signature.ed25519Signature?.data
    expect(sa?.length).toBe(64)
    expect(Array.from(sa!)).toEqual(Array.from(sb!))
  })

  it('only accepts an implicit (key-derived) account', () => {
    expect(() => new PrivySigner('player.contract-zero.testnet')).toThrow()
  })
})
