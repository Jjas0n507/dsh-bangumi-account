/**
 * Tool results must be lossless JSON: `undefined` and non-finite numbers are
 * rejected by the tool layer, so every tool result passes through here.
 */
export function sanitize(value) {
  if (value === undefined) return null
  if (value === null) return null
  if (Array.isArray(value)) return value.map(sanitize)
  const type = typeof value
  if (type === 'number') return Number.isFinite(value) ? value : null
  if (type === 'string' || type === 'boolean') return value
  if (type === 'bigint') return Number(value)
  if (type === 'object') {
    const output = {}
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue
      output[key] = sanitize(item)
    }
    return output
  }
  return null
}
