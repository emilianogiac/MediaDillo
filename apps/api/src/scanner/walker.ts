import fs from 'node:fs/promises'
import path from 'node:path'

const VIDEO_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv', '.flv',
  '.ts', '.mpg', '.mpeg', '.m2ts', '.vob', '.iso',
])

export interface WalkedFile {
  path: string
  sizeBytes: bigint
  mtimeMs: number
  parentFolder: string
}

// Recursively walk a root directory and yield video files.
// Skips hidden dirs and the .trash folder.
export async function* walkRoot(rootPath: string): AsyncGenerator<WalkedFile> {
  yield* walkDir(rootPath, rootPath)
}

async function readDirSafe(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return []
  }
}

async function* walkDir(dir: string, rootPath: string): AsyncGenerator<WalkedFile> {
  const entries = await readDirSafe(dir)

  for (const entry of entries) {
    const entryName = entry.name
    const fullPath = path.join(dir, entryName)

    if (entryName.startsWith('.') || entryName === '.trash') continue

    if (entry.isDirectory()) {
      yield* walkDir(fullPath, rootPath)
    } else if (entry.isFile()) {
      const ext = path.extname(entryName).toLowerCase()
      if (VIDEO_EXTENSIONS.has(ext)) {
        try {
          const stat = await fs.stat(fullPath)
          yield {
            path: fullPath,
            sizeBytes: BigInt(stat.size),
            mtimeMs: stat.mtimeMs,
            parentFolder: path.relative(rootPath, dir),
          }
        } catch {
          // file disappeared between readdir and stat — skip
        }
      }
    }
  }
}

export interface MovieFolder {
  folderPath: string
  files: WalkedFile[]
}

// Walk a movie-type scan root and yield one MovieFolder per leaf directory
// that contains video files. "Leaf" means the immediate parent of each video
// file — regardless of how deeply nested it is in the tree. No directory-level
// assumptions about depth or structure.
export async function* walkMovieFolders(rootPath: string): AsyncGenerator<MovieFolder> {
  // Collect all video files, group by their immediate parent directory.
  const byFolder = new Map<string, WalkedFile[]>()
  for await (const f of walkRoot(rootPath)) {
    const folder = path.dirname(f.path)
    const bucket = byFolder.get(folder)
    if (bucket) {
      bucket.push(f)
    } else {
      byFolder.set(folder, [f])
    }
  }
  for (const [folderPath, files] of byFolder) {
    yield { folderPath, files }
  }
}

// List ALL files in a directory (non-recursive) for stale detection
export async function listFolderFiles(folderPath: string): Promise<string[]> {
  const entries = await readDirSafe(folderPath)
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.join(folderPath, e.name))
}
