/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  output: 'standalone',
  serverExternalPackages: ['pdfjs-dist'],
}

export default nextConfig
