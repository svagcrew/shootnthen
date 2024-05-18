/* eslint-disable unicorn/no-unused-properties */
import { zLang, zLangProcessed } from '@/lib/utils'
import fg from 'fast-glob'
import _ from 'lodash'
import path from 'path'
import { getDataFromFile } from 'svag-cli-utils'
import { z } from 'zod'

export const zConfig = z.object({
  contentDir: z.string().min(1),
  googleCredentialsJsonPath: z.string().min(1),
  googleTokenJsonPath: z.string().min(1),
  googleDriveDirId: z.string().optional().nullable(),
  kinescopeParentId: z.string().optional().nullable(),
  auphonicPresetId: z.string().optional().nullable(),
  srcLang: zLang.optional().nullable(),
  distLangs: z.array(zLangProcessed),
})
export type Config = z.infer<typeof zConfig>
const defaultConfig: Config = {
  contentDir: '.',
  googleCredentialsJsonPath: './creds/google/credentials.json',
  googleTokenJsonPath: './creds/google/token.json',
  googleDriveDirId: null,
  kinescopeParentId: null,
  auphonicPresetId: null,
  srcLang: null,
  distLangs: [],
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
  const configMerged: Partial<Config> = {}
  for (const [index, configPath] of configPaths.reverse().entries()) {
    const isLast = index === configPaths.length - 1
    const configSource = await getDataFromFile({ filePath: configPath })
    if (isLast && !configSource.contentDir && !configMerged.contentDir) {
      configMerged.contentDir = path.resolve(path.dirname(configPath), defaultConfig.contentDir)
    } else {
      configMerged.contentDir = configSource.contentDir
        ? path.resolve(path.dirname(configPath), configSource.contentDir)
        : configMerged.contentDir
    }
    if (isLast && !configSource.googleCredentialsJsonPath && !configMerged.googleCredentialsJsonPath) {
      configMerged.googleCredentialsJsonPath = path.resolve(
        path.dirname(configPaths[0]),
        defaultConfig.googleCredentialsJsonPath
      )
    } else {
      configMerged.googleCredentialsJsonPath = configSource.googleCredentialsJsonPath
        ? path.resolve(path.dirname(configPath), configSource.googleCredentialsJsonPath)
        : configMerged.googleCredentialsJsonPath
    }
    if (isLast && !configSource.googleTokenJsonPath && !configMerged.googleTokenJsonPath) {
      configMerged.googleTokenJsonPath = path.resolve(path.dirname(configPaths[0]), defaultConfig.googleTokenJsonPath)
    } else {
      configMerged.googleTokenJsonPath = configSource.googleTokenJsonPath
        ? path.resolve(path.dirname(configPath), configSource.googleTokenJsonPath)
        : configMerged.googleTokenJsonPath
    }
    Object.assign(
      configMerged,
      _.omit(configSource, ['contentDir', 'googleCredentialsJsonPath', 'googleTokenJsonPath'])
    )
  }
  const configMergedValidated = zConfig.safeParse(configMerged)
  if (!configMergedValidated.success) {
    throw new Error(`Invalid config files ${configMergedValidated.error.message}`)
  }
  const config = configMergedValidated.data

  return { config }
}
