import { prisma } from '@backend/db/client'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'

export const auth = betterAuth({
	baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
	basePath: '/api/auth',
	secret: process.env.BETTER_AUTH_SECRET,
	database: prismaAdapter(prisma, { provider: 'sqlite' }),
	emailAndPassword: { enabled: true },
	// Fly's proxy supplies this header; only trust it inside the Fly runtime.
	...(process.env.FLY_APP_NAME
		? { advanced: { ipAddress: { ipAddressHeaders: ['fly-client-ip'] } } }
		: {}),
})
