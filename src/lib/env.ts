import * as dotenv from 'dotenv'
import path from 'path'
import z from 'zod'
import fs from 'fs'

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
  KINESCOPE_API_KEY: z.string(),
})

type Env = z.infer<typeof zEnv>

export const envRaw = {
  ...process.env,
}

export const validateEnv = () => {
  return zEnv.parse(envRaw)
}

export const getEnv = <T extends keyof Env>(key: T): Env[T] => {
  return zEnv.shape[key].parse(envRaw[key])
}
