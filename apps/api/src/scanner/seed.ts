import { prisma } from '@mediadillo/db'
import type { ScanRootConfig } from '../config.js'

export async function seedScanRootsFromEnv(roots: ScanRootConfig[]): Promise<void> {
  if (roots.length === 0) return
  for (const root of roots) {
    await prisma.scanRoot.upsert({
      where: { path: root.path },
      create: { path: root.path, label: root.label, type: root.type, enabled: true },
      update: { label: root.label, type: root.type },
    })
  }
}
