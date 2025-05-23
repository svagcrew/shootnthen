// import { getConfig } from '@/lib/config.js'
// import fg from 'fast-glob'
import path from 'path'
// import { stringsToLikeArrayString } from 'svag-cli-utils'
import z from 'zod'

export const langsProcessedAllowed = ['ru', 'en', 'es', 'pt', 'it', 'de', 'tr', 'hi', 'id'] as const
export const fromRawLang = (lang: string) => {
  if (lang.length === 2) return lang
  if (lang.length === 3 && lang[2] === 'r') return lang.slice(0, 2)
  throw new Error('Invalid lang: ' + lang)
}
export const toRawLang = (lang: string) => {
  if (lang.length === 2) return lang + 'r'
  if (lang.length === 3 && lang[2] === 'r') return lang
  throw new Error('Invalid lang: ' + lang)
}
export const langsRawAllowed = ['rur', 'enr'] as const
export const langs = [...langsProcessedAllowed, ...langsRawAllowed] as const
export const zLangProcessed = z.enum(langsProcessedAllowed)
export const zLangRaw = z.enum(langsRawAllowed)
export const zLang = z.enum([...langsProcessedAllowed, ...langsRawAllowed])
export type Lang = (typeof langs)[number]
export type LangProcessed = (typeof langsProcessedAllowed)[number]
export type LangRaw = (typeof langsRawAllowed)[number]

// export const getFilePathAndConfigByGlob = async ({ glob }: { glob: string }) => {
//   const filePaths = await fg([glob], {
//     onlyFiles: true,
//     absolute: true,
//     ignore: ['**/node_modules/**'],
//   })
//   if (filePaths.length === 0) {
//     throw new Error('File not found')
//   }
//   if (filePaths.length !== 1) {
//     throw new Error(`Multiple files found: ${stringsToLikeArrayString(filePaths)}`)
//   }
//   const filePath = filePaths[0]
//   const config = getConfig({ dirPath: path.dirname(filePath) })
//   return { filePath, config }
// }

export const wait = async (s: number) => await new Promise((resolve) => setTimeout(resolve, s * 1_000))

export const addSuffixToFilePath = ({ filePath, suffix }: { filePath: string; suffix: string }) => {
  const ext = path.extname(filePath)
  const base = path.basename(filePath, ext)
  return `${base}.${suffix}${ext}`
}

export const replaceExt = ({ filePath, ext }: { filePath: string; ext: string }) => {
  const base = path.basename(filePath, path.extname(filePath))
  return `${base}.${ext}`
}
