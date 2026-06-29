import path from 'path'
import os from 'os'

type SmartcomprovantePathEnv = {
  [key: string]: string | undefined
  SMARTCOMPROVANTE_DATA_DIR?: string
  VERCEL?: string
  NOW_REGION?: string
}

const isReadOnlyVercelPath = (value: string) => value.replace(/\\/g, '/').startsWith('/var/task')

export const resolveSmartcomprovanteDataRoot = (
  env: SmartcomprovantePathEnv = process.env,
  cwd = process.cwd(),
  tempRoot = os.tmpdir(),
) => {
  const isVercel = Boolean(env.VERCEL || env.NOW_REGION)
  const configuredRoot = env.SMARTCOMPROVANTE_DATA_DIR?.trim()

  if (configuredRoot && !(isVercel && isReadOnlyVercelPath(configuredRoot))) {
    return configuredRoot
  }

  return isVercel ? path.join(tempRoot, '.smartcomprovante-data') : path.join(cwd, '.smartcomprovante-data')
}

export const SMARTCOMPROVANTE_DATA_ROOT = resolveSmartcomprovanteDataRoot()
