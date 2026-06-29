/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  output: 'standalone',
  serverExternalPackages: ['pino', 'pino-pretty', 'firebase-admin'],
  outputFileTracingExcludes: {
    '*': [
      './.smartcomprovante-data/cache/**/*',
      './.smartcomprovante-data/uploads/**/*',
      './.smartcomprovante-data/reports/**/*',
    ],
  },
}

export default nextConfig
