import type { Config } from '@/lib/config.js'
import { fromRawLang, langs as allLangs, langsProcessedAllowed, langsRawAllowed } from '@/lib/utils.js'
import fsync from 'fs'
import _ from 'lodash'
import path from 'path'
import { getDataFromFileSync, isFileExistsSync } from 'svag-cli-utils'
import z from 'zod'

export const zMeta = z.object({
  title: z.string().optional(),
  revai: z
    .object({
      lastTranscriptJobId: z.string().optional(),
    })
    .default({}),
  loom: z
    .object({
      videos: z
        .array(
          z.object({
            id: z.string(),
            url: z.string(),
            title: z.string(),
            filePath: z.string(),
          })
        )
        .default([]),
    })
    .default({ videos: [] }),
  auphonic: z
    .object({
      projects: z
        .array(
          z.object({
            srcFilePath: z.string().nullable().default(null),
            distFilePath: z.string().nullable().default(null),
            presetId: z.string(),
            id: z.string(),
          })
        )
        .default([]),
    })
    .default({ projects: [] }),
  youtube: z
    .object({
      videos: z
        .array(
          z.object({
            id: z.string(),
            title: z.string(),
            viewUrl: z.string(),
            editUrl: z.string(),
            filePath: z.string(),
          })
        )
        .default([]),
    })
    .default({ videos: [] }),
  elevenlabs: z
    .object({
      dubbings: z
        .array(
          z.object({
            srcUrl: z.string().nullable().default(null),
            srcFilePath: z.string().nullable().default(null),
            distFilePath: z.string().nullable().default(null),
            id: z.string(),
            srcLang: z.string(),
            distLang: z.string(),
            duration: z.number(),
          })
        )
        .default([]),
    })
    .default({ dubbings: [] }),
  rask: z
    .object({
      projects: z
        .array(
          z.object({
            srcUrl: z.string().nullable().default(null),
            srcFilePath: z.string().nullable().default(null),
            distFilePath: z.string().nullable().default(null),
            id: z.string(),
            srcLang: z.string(),
            distLang: z.string(),
          })
        )
        .default([]),
    })
    .default({ projects: [] }),
  kinescope: z
    .object({
      videos: z
        .array(
          z.object({
            id: z.string(),
            filePath: z.string(),
          })
        )
        .default([]),
    })
    .default({ videos: [] }),
  googleDrive: z
    .object({
      files: z
        .array(
          z.object({
            id: z.string(),
            dirId: z.string(),
            filePath: z.string(),
            name: z.string(),
          })
        )
        .default([]),
    })
    .default({ files: [] }),
})
export type Meta = z.infer<typeof zMeta>

const marksAllowed = [...langsProcessedAllowed, ...langsRawAllowed] as string[]

export const parseFileName = (fileName: string) => {
  const dirname = path.dirname(fileName)
  const basename = path.basename(fileName)
  const parts = basename.split('.')
  const ext = parts.pop()
  const langsRaw = langsRawAllowed.filter((lang) => parts.includes(lang)).map(fromRawLang)
  const langsProcessed = langsProcessedAllowed.filter((lang) => parts.includes(lang))
  const langs = [...new Set([...langsProcessed, ...langsRaw])]
  const langSingle = langs.length === 1 ? langs[0] : null
  const notMarks = parts.filter((part) => !marksAllowed.includes(part))
  const marks = parts.filter((part) => marksAllowed.includes(part))
  const notLangMarks = marks.filter((part) => !allLangs.includes(part as any))
  const name = notMarks.join('.')

  return { name, langsProcessed, langsRaw, langs, marks, notLangMarks, ext, langSingle, basename, dirname }
}

export const getMetaFilePath = ({ filePath, config }: { filePath: string; config: Config }) => {
  const parsed = parseFileName(filePath)
  const metaFileName = `${parsed.name}.json`
  const metaFilePath = path.resolve(config.contentDir, metaFileName)
  return { metaFilePath }
}

export const getMeta = ({ metaFilePath }: { metaFilePath: string }) => {
  const { fileExists } = isFileExistsSync({ filePath: metaFilePath })
  if (!fileExists) {
    return { meta: zMeta.parse({}) }
  }
  const data = getDataFromFileSync({ filePath: metaFilePath })
  const meta = zMeta.parse(data)
  return { meta }
}

export const getMetaByFilePath = ({ filePath, config }: { filePath: string; config: Config }) => {
  const { metaFilePath } = getMetaFilePath({ filePath, config })
  const { meta } = getMeta({ metaFilePath })
  return { meta, metaFilePath }
}

export const updateMeta = ({ meta, metaFilePath }: { meta: Meta; metaFilePath: string }) => {
  const result = _.cloneDeep(meta) as any
  if (!result.loom.videos.length) {
    delete result.loom
  }
  if (!result.auphonic.projects.length) {
    delete result.auphonic
  }
  if (!result.youtube.videos.length) {
    delete result.youtube
  }
  if (!result.elevenlabs.dubbings.length) {
    delete result.elevenlabs
  }
  if (!result.rask.projects.length) {
    delete result.rask
  }
  if (!result.kinescope.videos.length) {
    delete result.kinescope
  }
  if (!result.googleDrive.files.length) {
    delete result.googleDrive
  }
  fsync.writeFileSync(metaFilePath, JSON.stringify(result, null, 2))
}
