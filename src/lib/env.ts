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
const envFilePath = findEnvFilePath(__dirname, '.env')
if (envFilePath) {
  dotenv.config({ path: envFilePath, override: true })
  dotenv.config({ path: `${envFilePath}.${process.env.NODE_ENV}`, override: true })
}

const zEnv = z.object({
  OPENAI_API_KEY: z.string(),
})

type Env = z.infer<typeof zEnv>

export const envRaw = {
  OPENAI_API_KEY: process.env.I777N_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
}

export const validateEnv = () => {
  return zEnv.parse(envRaw)
}

export const getEnv = (key: keyof Env) => {
  return zEnv.parse(envRaw)[key]
}
