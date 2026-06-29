import pino from 'pino'

// Keep this dependency-light. API routes import the logger at route-load time;
// optional transports such as pino-pretty can crash local dev routes if missing.
const isProduction = process.env.NODE_ENV === 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
})

export const routeLogger = (route: string) => logger.child({ route })
