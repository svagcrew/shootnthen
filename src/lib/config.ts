import fg from 'fast-glob'
import path from 'path'
import { getDataFromFile, stringsToLikeArrayString } from 'svag-cli-utils'
import { z } from 'zod'

export const zConfig = z.object({
  contentDir: z.string().min(1),
})
export type Config = z.infer<typeof zConfig>
const defaultConfig: Config = {
  contentDir: './content',
}

const findAllConfigsPaths = async ({ dirPath }: { dirPath: string }) => {
  const configPaths: string[] = []
  let dirPathHere = path.resolve('/', dirPath)
  for (let i = 0; i < 777; i++) {
    const maybeConfigGlob = `${dirPathHere}/shootnthen.config.(js|mjs|ts|yml|yaml|json)`
    const maybeConfigPath = (
      await fg([maybeConfigGlob], {
        onlyFiles: true,
        absolute: true,
      })
    )[0]
    if (maybeConfigPath) {
      configPaths.push(maybeConfigPath)
    }
    const parentDirPath = path.resolve(dirPathHere, '..')
    if (dirPathHere === parentDirPath) {
      return { configPaths }
    }
    dirPathHere = parentDirPath
  }
  return { configPaths }
}

export const getConfig = async ({ dirPath }: { dirPath: string }) => {
  const { configPaths } = await findAllConfigsPaths({ dirPath })
  if (configPaths.length === 0) {
    throw new Error('Config file not found')
  }
  if (configPaths.length > 1) {
    throw new Error(`Multiple config files found: ${stringsToLikeArrayString(configPaths)}`)
  }
  const configPath = configPaths[0]
  const configSource = await getDataFromFile({ filePath: configPath })
  const configSourceValidated = zConfig.safeParse(configSource)
  if (!configSourceValidated.success) {
    throw new Error(`Invalid core config file: "${configPath}": ${configSourceValidated.error.message}`)
  }
  const configMerged = { ...defaultConfig, ...configSource }
  const configMergedValidated = zConfig.safeParse(configMerged)
  if (!configMergedValidated.success) {
    throw new Error(`Invalid core config file: "${configPath}": ${configMergedValidated.error.message}`)
  }
  const config = configMergedValidated.data
  config.contentDir = path.resolve(path.dirname(configPath), config.contentDir)
  return { config }
}
