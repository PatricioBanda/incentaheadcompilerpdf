/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ['pdfjs-dist', 'pdf-lib', 'pino', 'pino-pretty', 'firebase-admin'],
  outputFileTracingIncludes: {
    '**': ['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
  },
  outputFileTracingExcludes: {
    '*': [
      './.smartcomprovante-data/cache/**/*',
      './.smartcomprovante-data/uploads/**/*',
      './.smartcomprovante-data/reports/**/*',
    ],
  },
}

export default nextConfig
