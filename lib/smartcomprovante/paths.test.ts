import path from 'path'
import { resolveSmartcomprovanteDataRoot } from './paths'

describe('resolveSmartcomprovanteDataRoot', () => {
  it('uses a configured local data root outside Vercel', () => {
    expect(resolveSmartcomprovanteDataRoot({ SMARTCOMPROVANTE_DATA_DIR: 'C:/data' }, 'C:/app')).toBe('C:/data')
  })

  it('uses the workspace data root by default outside Vercel', () => {
    expect(resolveSmartcomprovanteDataRoot({}, 'C:/app')).toBe(path.join('C:/app', '.smartcomprovante-data'))
  })

  it('uses /tmp on Vercel when no data root is configured', () => {
    expect(resolveSmartcomprovanteDataRoot({ VERCEL: '1' }, '/var/task', '/tmp')).toBe(path.join('/tmp', '.smartcomprovante-data'))
  })

  it('ignores a read-only /var/task data root on Vercel', () => {
    expect(resolveSmartcomprovanteDataRoot({
      VERCEL: '1',
      SMARTCOMPROVANTE_DATA_DIR: '/var/task/.smartcomprovante-data',
    }, '/var/task', '/tmp')).toBe(path.join('/tmp', '.smartcomprovante-data'))
  })

  it('keeps a writable explicit data root on Vercel', () => {
    expect(resolveSmartcomprovanteDataRoot({
      VERCEL: '1',
      SMARTCOMPROVANTE_DATA_DIR: '/tmp/custom-smartcomprovante',
    }, '/var/task')).toBe('/tmp/custom-smartcomprovante')
  })
})
