'use client'

// Email sign-in through Privy. Privy authenticates the email and holds the player's
// NEAR (ed25519) key in its embedded wallet; it never holds anything of ours. What
// proves the account to the game server is the same NEP-413 signature a wallet gives
// (lib/auth.ts, signInEmail), for the implicit account of that key.
//
// Privy's SDK is large and only some players need it, so it isn't in the app's
// provider tree: this module (imported on demand) mounts PrivyProvider in its own
// small detached React root the first time it's needed, and exposes promise-based
// login and signing to non-React code. The game's fight pages never load it.
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivyProvider, getAccessToken, useLogin, useLogout, usePrivy, type User } from '@privy-io/react-auth'
import { useCreateWallet, useSignRawHash } from '@privy-io/react-auth/extended-chains'
import { PublicKey, Signer } from 'near-api-js'

type Hooks = {
  ready: boolean
  authenticated: boolean
  user: User | null
  login: () => void
  logout: () => Promise<void>
  createWallet: ReturnType<typeof useCreateWallet>['createWallet']
  signRawHash: ReturnType<typeof useSignRawHash>['signRawHash']
}

let hooks: Hooks | null = null
let mounted: Promise<void> | null = null
let onReady: (() => void) | null = null
let pendingLogin: { resolve: (u: User) => void; reject: (e: Error) => void } | null = null

function Bridge() {
  const { ready, authenticated, user } = usePrivy()
  const { login } = useLogin({
    onComplete: ({ user }) => { pendingLogin?.resolve(user); pendingLogin = null },
    onError: (code) => { pendingLogin?.reject(new Error(code === 'exited_auth_flow' ? 'Sign-in was cancelled.' : `Email sign-in failed (${code}).`)); pendingLogin = null },
  })
  const { logout } = useLogout()
  const { createWallet } = useCreateWallet()
  const { signRawHash } = useSignRawHash()
  hooks = { ready, authenticated, user, login: () => login(), logout, createWallet, signRawHash }
  useEffect(() => { if (ready) onReady?.() }, [ready])
  return null
}

/** Mount Privy (once) and wait until it has restored any existing Privy session. */
export function start(appId: string): Promise<void> {
  if (!mounted) {
    mounted = new Promise<void>((resolve) => {
      onReady = resolve
      const el = document.createElement('div')
      el.id = 'cz-privy'
      document.body.appendChild(el)
      createRoot(el).render(
        <PrivyProvider
          appId={appId}
          config={{
            loginMethods: ['email'],
            appearance: { theme: 'dark', accentColor: '#22d3ee', landingHeader: 'Sign in to CONTRACT ZERO', showWalletLoginFirst: false },
            // The NEAR wallet is created explicitly below; no EVM or Solana wallets.
            embeddedWallets: { ethereum: { createOnLogin: 'off' }, solana: { createOnLogin: 'off' } },
          }}
        >
          <Bridge />
        </PrivyProvider>,
      )
    })
  }
  return mounted
}

/** Tests only: stand in for Privy's hooks. */
export function __setHooksForTest(x: Hooks | null) { hooks = x }

const h = () => {
  if (!hooks) throw new Error('email sign-in is not ready yet')
  return hooks
}

/** The player's Privy user, logging in (Privy's email code modal) if needed. */
export async function login(): Promise<User> {
  const s = h()
  if (s.authenticated && s.user) return s.user
  return new Promise<User>((resolve, reject) => {
    pendingLogin = { resolve, reject }
    s.login()
  })
}

const nearOf = (u: User) => u.linkedAccounts.find((a) => a.type === 'wallet' && (a as { chainType?: string }).chainType === 'near') as { address: string } | undefined

/** The player's NEAR account (the implicit account of its Privy-held key), creating
 *  the key on first sign-in. */
export async function nearAccount(user: User): Promise<string> {
  const have = nearOf(user)
  if (have) return have.address
  const { wallet } = await h().createWallet({ chainType: 'near' })
  return wallet.address
}

export const accessToken = async (): Promise<string> => {
  const t = await getAccessToken()
  if (!t) throw new Error('your email sign-in expired; sign in again')
  return t
}

export async function logout(): Promise<void> {
  if (hooks?.authenticated) await hooks.logout()
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const unhex = (s: string) => Uint8Array.from(s.replace(/^0x/, '').match(/../g) ?? [], (x) => parseInt(x, 16))

/** A near-api-js signer backed by the Privy-held key of an implicit account.
 *  near-api-js serializes and hashes transactions, delegate actions and NEP-413
 *  messages; Privy signs the 32-byte hash (ed25519). */
export class PrivySigner extends Signer {
  constructor(private readonly account: string) {
    super()
    if (!/^[0-9a-f]{64}$/.test(account)) throw new Error('not an email account')
  }
  async getPublicKey(): Promise<PublicKey> {
    return new PublicKey({ keyType: 0, data: unhex(this.account) })
  }
  protected async signBytes(hash: Uint8Array): Promise<Uint8Array> {
    // Privy's session can lapse while ours (7 days) is still valid: re-login first.
    const s = h()
    if (!s.authenticated) await login()
    const { signature } = await h().signRawHash({ address: this.account, chainType: 'near', hash: `0x${hex(hash)}` })
    const sig = unhex(signature)
    if (sig.length !== 64) throw new Error('unexpected signature from email sign-in')
    return sig
  }
}
