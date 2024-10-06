/* eslint-disable n/no-process-env */
import * as dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import z from 'zod'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const findEnvFilePath = (dir: string, pathPart: string): string | null => {
  const maybeEnvFilePath = path.join(dir, pathPart)
  if (fs.existsSync(maybeEnvFilePath)) {
    return maybeEnvFilePath
  }
  if (dir === '/') {
    return null
  }
  return findEnvFilePath(path.dirname(dir), pathPart)
}
const envFilePath = findEnvFilePath(process.cwd(), '.env.shootnthen') || findEnvFilePath(__dirname, '.env.shootnthen')
if (envFilePath) {
  dotenv.config({ path: envFilePath, override: true })
  dotenv.config({ path: `${envFilePath}.${process.env.NODE_ENV}`, override: true })
}

const zEnv = z.object({
  ELEVENLABS_API_KEY: z.string(),
  ELEVENLABS_EMAIL: z.string(),
  ELEVENLABS_PASSWORD: z.string(),
  RASK_EMAIL: z.string(),
  RASK_PASSWORD: z.string(),
  AUPHONIC_EMAIL: z.string(),
  AUPHONIC_PASSWORD: z.string(),
  KINESCOPE_API_KEY: z.string(),
  REVAI_ACCESS_TOKEN: z.string(),
  AZURE_AI_KEY: z.string(),
  AZURE_AI_REGION: z.string(),
  OPENAI_API_KEY: z.string(),
})

type Env = z.infer<typeof zEnv>

export const envRaw = {
  ...process.env,
}

export const getEnv = <T extends keyof Env>(key: T): Env[T] => {
  return (zEnv as any).pick({ [key]: zEnv.shape[key] }).parse(envRaw)[key]
}
