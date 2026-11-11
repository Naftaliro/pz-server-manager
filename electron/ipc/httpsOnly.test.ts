import { describe, it, expect } from 'vitest'
import { redirectTarget } from './httpsOnly'

describe('redirects for downloads', () => {
  const from = 'https://github.com/Naftaliro/pz-server-manager/releases/download/v1.6.1/Knox.zip'

  it('follows https ones, relative ones too', () => {
    expect(redirectTarget(from, 'https://release-assets.githubusercontent.com/x?sig=1')).toBe('https://release-assets.githubusercontent.com/x?sig=1')
    expect(redirectTarget(from, '/Naftaliro/other')).toBe('https://github.com/Naftaliro/other')
  })

  it('never goes to plain http or anything else', () => {
    for (const bad of ['http://release-assets.githubusercontent.com/x', 'file:///C:/x.zip', 'ftp://x/y', 'javascript:alert(1)', '//evil.example:80/x'.replace('//', 'http://')]) {
      expect(redirectTarget(from, bad), bad).toBeNull()
    }
    expect(redirectTarget('http://insecure.example/', '/x')).toBeNull()
  })
})
