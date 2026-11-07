/** Local cache under $DSH_HOME/bangumi-account, with atomic writes. */
import { mkdir, readFile, writeFile, rename, rm, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const SCHEMA_VERSION = 1

function homeDir() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function createStore() {
  const root = join(homeDir(), 'bangumi-account')
  const subjectDir = join(root, 'subjects')

  async function ensure() {
    await mkdir(subjectDir, { recursive: true })
  }

  async function readJson(path, fallback = null) {
    try {
      const text = await readFile(path, 'utf8')
      return JSON.parse(text)
    } catch {
      return fallback
    }
  }

  async function writeJson(path, value) {
    await ensure()
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporary, JSON.stringify(value), 'utf8')
    await rename(temporary, path)
  }

  return {
    root,
    ensure,
    async readMeta() {
      const meta = await readJson(join(root, 'meta.json'))
      return meta && meta.schemaVersion === SCHEMA_VERSION ? meta : null
    },
    saveMeta(meta) {
      return writeJson(join(root, 'meta.json'), { schemaVersion: SCHEMA_VERSION, ...meta })
    },
    async readCollections() {
      const data = await readJson(join(root, 'collections.json'))
      return data && data.schemaVersion === SCHEMA_VERSION && Array.isArray(data.items) ? data.items : null
    },
    saveCollections(items) {
      return writeJson(join(root, 'collections.json'), { schemaVersion: SCHEMA_VERSION, items })
    },
    async readProfile() {
      const data = await readJson(join(root, 'profile.json'))
      return data && data.schemaVersion === SCHEMA_VERSION ? data : null
    },
    saveProfile(profile) {
      return writeJson(join(root, 'profile.json'), { schemaVersion: SCHEMA_VERSION, ...profile })
    },
    async readSubject(id) {
      const entry = await readJson(join(subjectDir, `${id}.json`))
      return entry && entry.schemaVersion === SCHEMA_VERSION ? entry : null
    },
    saveSubject(id, subject, ttlDays) {
      const savedAt = Date.now()
      const expiresAt = ttlDays > 0 ? savedAt + ttlDays * 86400000 : 0
      return writeJson(join(subjectDir, `${id}.json`), { schemaVersion: SCHEMA_VERSION, savedAt, expiresAt, subject })
    },
    /** @returns {Promise<object|null>} cached subject when fresh. */
    async readFreshSubject(id) {
      const entry = await this.readSubject(id)
      if (!entry) return null
      if (entry.expiresAt && entry.expiresAt < Date.now()) return null
      return entry.subject
    },
    async readGrantFile() {
      return readJson(join(root, 'grant.json'))
    },
    async saveGrantFile(grant) {
      await ensure()
      const path = join(root, 'grant.json')
      const temporary = `${path}.${process.pid}.tmp`
      await writeFile(temporary, JSON.stringify(grant), { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, path)
    },
    async removeGrantFile() {
      await rm(join(root, 'grant.json'), { force: true })
    },
    async clearCache() {
      await rm(join(root, 'collections.json'), { force: true })
      await rm(join(root, 'profile.json'), { force: true })
      await rm(join(root, 'meta.json'), { force: true })
      await rm(subjectDir, { force: true, recursive: true })
    },
    async removeAll() {
      await rm(root, { force: true, recursive: true })
    },
    async stats() {
      const files = {}
      for (const name of ['meta.json', 'collections.json', 'profile.json', 'grant.json']) {
        try {
          files[name] = (await stat(join(root, name))).size
        } catch {
          files[name] = 0
        }
      }
      try {
        files.subjects = (await readdir(subjectDir)).length
      } catch {
        files.subjects = 0
      }
      return { root, files }
    },
  }
}
