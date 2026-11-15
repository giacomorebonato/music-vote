import { prisma } from '@backend/db/client'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import {
	resolveAuthBaseURL,
	resolveAuthTrustedOrigins,
	resolveUseSecureCookies,
} from './base-url'

const advanced: {
	ipAddress?: { ipAddressHeaders: string[] }
	useSecureCookies?: false
} = {}
// Fly's proxy supplies this header; only trust it inside the Fly runtime.
if (process.env.FLY_APP_NAME)
	advanced.ipAddress = { ipAddressHeaders: ['fly-client-ip'] }
// Under dev:net with an http portless origin, __Secure- cookies are dropped
// by the browser — see ./base-url.
if (resolveUseSecureCookies() === false) advanced.useSecureCookies = false

export const auth = betterAuth({
	baseURL: resolveAuthBaseURL(),
	trustedOrigins: resolveAuthTrustedOrigins(),
	basePath: '/api/auth',
	secret: process.env.BETTER_AUTH_SECRET,
	database: prismaAdapter(prisma, { provider: 'sqlite' }),
	emailAndPassword: { enabled: true },
	...(Object.keys(advanced).length > 0 ? { advanced } : {}),
})
