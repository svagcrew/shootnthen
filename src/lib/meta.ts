import { Config } from '@/lib/config'
import { fromRawLang, langsProcessedAllowed, langsRawAllowed } from '@/lib/utils'
import fsync from 'fs'
import path from 'path'
import { getDataFromFileSync, isFileExistsSync } from 'svag-cli-utils'
import z from 'zod'

export const zMeta = z.object({
  title: z.string().optional(),
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
  kinescope: z
    .object({
      videos: z
        .array(
          z.object({
            id: z.string(),
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
  const basename = path.basename(fileName)
  const parts = basename.split('.')
  const ext = parts.pop()
  const langsRaw = langsRawAllowed.filter((lang) => parts.includes(lang)).map(fromRawLang)
  const langsProcessed = langsProcessedAllowed.filter((lang) => parts.includes(lang))
  const langs = [...new Set([...langsProcessed, ...langsRaw])]
  const langSingle = langs.length === 1 ? langs[0] : null
  const notMarks = parts.filter((part) => !marksAllowed.includes(part))
  const marks = parts.filter((part) => marksAllowed.includes(part))
  const notLangMarks = marks.filter((part) => !langs.includes(part))
  const name = notMarks.join('.')

  return { name, langsProcessed, langsRaw, langs, marks, notLangMarks, ext, langSingle, basename }
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
  fsync.writeFileSync(metaFilePath, JSON.stringify(meta, null, 2))
}
