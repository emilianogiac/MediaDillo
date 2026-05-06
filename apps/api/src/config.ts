import { z } from 'zod'

const ScanRootSchema = z.object({
  path: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['movies', 'tv']),
})

const ConfigSchema = z.object({
  PORT: z.coerce.number().default(7731),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1),
  SCAN_ROOTS: z
    .string()
    .transform((val) => JSON.parse(val))
    .pipe(z.array(ScanRootSchema))
    .default('[]'),
  TMDB_API_KEY: z.string().optional(),
  TVDB_API_KEY: z.string().optional(),
  JELLYFIN_URL: z.string().optional(),
  JELLYFIN_API_KEY: z.string().optional(),
})

const parsed = ConfigSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const config = parsed.data
export type ScanRootConfig = z.infer<typeof ScanRootSchema>
