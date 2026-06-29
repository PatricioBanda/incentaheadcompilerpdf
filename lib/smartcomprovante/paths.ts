import path from 'path'

const isVercel = Boolean(process.env.VERCEL || process.env.NOW_REGION)

export const SMARTCOMPROVANTE_DATA_ROOT = process.env.SMARTCOMPROVANTE_DATA_DIR
  || (isVercel ? path.join('/tmp', '.smartcomprovante-data') : path.join(process.cwd(), '.smartcomprovante-data'))

