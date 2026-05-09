import fs from 'node:fs/promises'

// Move a file, falling back to copy+delete when source and destination are on different filesystems.
export async function moveFile(src: string, dst: string): Promise<void> {
  try {
    await fs.rename(src, dst)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await fs.copyFile(src, dst)
    await fs.unlink(src)
  }
}
