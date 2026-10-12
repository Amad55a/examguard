import { readFileSync } from 'node:fs'

const configPath = new URL('../config/production.json', import.meta.url)
const config = JSON.parse(readFileSync(configPath, 'utf8'))

let apiUrl
try {
  apiUrl = new URL(config.apiBaseUrl)
} catch {
  throw new Error('Production packaging requires config/production.json to contain the UniCORE HTTPS API URL.')
}

if (
  apiUrl.protocol !== 'https:' ||
  apiUrl.username ||
  apiUrl.password ||
  apiUrl.search ||
  apiUrl.hash
) {
  throw new Error('The production UniCORE API URL must use HTTPS and must not contain credentials, a query, or a fragment.')
}

if (!/\/api(?:\/v1)?$/.test(apiUrl.pathname.replace(/\/+$/, ''))) {
  throw new Error('The production UniCORE API URL must include its /api or /api/v1 base path.')
}

console.log(`Production API endpoint configured: ${apiUrl.origin}`)
