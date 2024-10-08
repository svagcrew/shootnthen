import type { Config } from '@/lib/config.js'
import { getEnv } from '@/lib/env.js'
import { parseFileName } from '@/lib/meta.js'
import { wait } from '@/lib/utils.js'
import { promises as fs } from 'fs'
import _ from 'lodash'
import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import type { ChatCompletionMessageParam } from 'openai/resources/index.mjs'
import path from 'path'
import SrtParser from 'srt-parser-2'
import { isFileExistsSync, log } from 'svag-cli-utils'
import type { z } from 'zod'

const getOpenaiClient = () => {
  const openaiApiKey = getEnv('OPENAI_API_KEY')
  if (!openaiApiKey) {
    throw new Error('OpenAI API key not provided')
  }
  const openai = new OpenAI({
    apiKey: openaiApiKey,
  })
  return { openai }
}

export const completionByOpenai = async <T>({
  systemPrompt,
  userPrompt,
  jsonSchema,
  zodSchema,
}: {
  systemPrompt?: string
  userPrompt: string
  jsonSchema?: any
  zodSchema?: z.ZodType<any, any>
}): Promise<T> => {
  const { openai } = getOpenaiClient()
  const chatMessages: ChatCompletionMessageParam[] = [
    ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
    { role: 'user' as const, content: userPrompt },
  ]
  const res = await openai.chat.completions.create({
    messages: chatMessages,
    model: 'gpt-4o',
    ...(!jsonSchema
      ? {}
      : {
          function_call: {
            name: 'structuredResponse',
          },
          functions: [
            {
              name: 'structuredResponse',
              parameters: jsonSchema,
              description: 'Generate structured response',
            },
          ],
        }),
    ...(!zodSchema
      ? {}
      : {
          response_format: zodResponseFormat(zodSchema, 'structuredResponse'),
        }),
  })
  if (jsonSchema) {
    const responseStructuredRaw = res.choices[0].message.function_call?.arguments
    if (!responseStructuredRaw) {
      throw new Error('OpenAI structured response not found')
    }
    const responseStructured = (() => {
      try {
        return JSON.parse(responseStructuredRaw)
      } catch {
        throw new Error('OpenAI structured response not parsed as JSON')
      }
    })()
    if (!responseStructured) {
      throw new Error('OpenAI parsed structured response not found')
    }
    return responseStructured as T
  } else if (zodSchema) {
    return (res.choices[0].message as any).parsed
  } else {
    const responseText = res.choices[0].message.content
    if (!responseText) {
      throw new Error('OpenAI response not found')
    }
    return responseText as T
  }
}

const translateFewStringByOpenai = async ({
  verbose,
  srcLang,
  distLang,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  translatedStrings = [],
  notTranslatedStrings,
}: {
  verbose?: boolean
  srcLang: string
  distLang: string
  translatedStrings?: Array<{ src: string; dist: string }>
  notTranslatedStrings: string[]
}): Promise<
  Array<{
    src: string
    dist: string
  }>
> => {
  if (notTranslatedStrings.length === 0) {
    throw new Error('No strings to translate')
  }
  const langsNames = {
    en: 'English',
    ru: 'Russian',
  }
  const srcLangName = (langsNames as any)[srcLang] as string
  const distLangName = (langsNames as any)[distLang] as string
  if (!srcLangName || !distLangName) {
    throw new Error('Language name not found')
  }
  let tryIndex = 0
  while (true) {
    try {
      verbose && log.normal('Translating few strings by OpenAI', { srcLang, distLang, tryIndex })
      const systemPromptStart = `Act as subtitles translator.
Translate subtitles provided by user from ${srcLangName} to ${distLangName}.
Short strings should be translated to short strings, long strings to long strings,
because the length of the translated strings should be similar to the original ones.
STRONGLY Keep the original count of strings: ${notTranslatedStrings.length}.
REPLY with only the translated subtitles, WITHOUT additional information, comments, etc.
User will provide you with array of original strings and you should reply with array of translated strings.`
      //       const systemPromptEnd = !translatedStrings ? null : `Take a notice that previously was translated some previous strings and you should continue from there:
      // ${translatedStrings.map(({ src, dist }) => `${src} -> ${dist}`).join('\n')}`
      const systemPromptEnd = null
      const systemPrompt = [systemPromptStart, systemPromptEnd].filter(Boolean).join('\n\n')
      const resRaw = await completionByOpenai<{ translatedArray: string[] }>({
        systemPrompt,
        userPrompt: JSON.stringify(notTranslatedStrings, null, 2),
        jsonSchema: {
          type: 'object',
          properties: {
            translatedArray: {
              type: 'array',
              items: {
                type: 'string',
              },
              minItems: notTranslatedStrings.length,
              maxItems: notTranslatedStrings.length,
            },
          },
          required: ['translatedArray'],
          additionalProperties: false,
        },
        // zodSchema: z.array(z.string()).length(subtitles.length),
      })
      const res = resRaw.translatedArray
      if (!res) {
        throw new Error('Translated array not found')
      }
      if (res.length !== notTranslatedStrings.length) {
        throw new Error(
          `Translated array length mismatch. Expected: ${notTranslatedStrings.length}, got: ${res.length}`
        )
      }
      return res.map((dist, i) => ({ src: notTranslatedStrings[i], dist }))
    } catch (error) {
      verbose && log.red('translateFewStringByOpenai Error', error)
      tryIndex++
      if (tryIndex >= 5) {
        throw error
      } else {
        verbose && log.normal('Retrying translateFewStringByOpenai after 5 sec...', { srcLang, distLang, tryIndex })
        await wait(5)
      }
    }
  }
}

export const translateSrtByOpenai = async ({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  config,
  srcSrtPath,
  distSrtPath,
  srcLang,
  distLang,
  verbose,
  force,
}: {
  config: Config
  srcSrtPath: string
  distSrtPath?: string
  srcLang?: string
  distLang: string
  verbose?: boolean
  force?: boolean
}) => {
  verbose && log.normal('Translating srt', { srcSrtPath, distLang })
  const parsed = parseFileName(srcSrtPath)
  if (parsed.ext !== 'srt') {
    throw new Error('Only srt files are allowed')
  }
  if (!srcLang) {
    if (parsed.langSingle) {
      srcLang = parsed.langSingle
    } else {
      throw new Error('srcLang not found')
    }
  }
  distSrtPath = distSrtPath || path.resolve(parsed.dirname, `${parsed.name}.${distLang}.srt`)
  const { fileExists } = isFileExistsSync({ filePath: distSrtPath })
  if (fileExists && !force) {
    verbose && log.normal('Srt file already exists', { distSrtPath })
    return { distSrtPath }
  }

  const srcSrtContent = await fs.readFile(srcSrtPath, 'utf8')
  const parser = new SrtParser()
  const srcSubtitles = parser.fromSrt(srcSrtContent) // Parse SRT
  const srcSubtitlesTexts = srcSubtitles.map((subtitle) => subtitle.text.replaceAll('\n', ' '))
  const distSubtitlesTexts: string[] = []

  const chunkSize = 7
  const srcSubtitlesChunks = _.chunk(srcSubtitlesTexts, chunkSize)
  for (const [i, chunk] of srcSubtitlesChunks.entries()) {
    verbose &&
      log.normal('Translating chunk', { chunkSize, chunkNumber: i + 1, totalChunksCount: srcSubtitlesChunks.length })
    const translatedChunk = await translateFewStringByOpenai({
      verbose,
      srcLang,
      distLang,
      notTranslatedStrings: chunk,
    })
    for (const [j, { dist }] of translatedChunk.entries()) {
      distSubtitlesTexts[i * chunkSize + j] = dist
    }
  }

  for (const [i, srcSubtitle] of srcSubtitles.entries()) {
    srcSubtitle.text = distSubtitlesTexts[i]
  }
  const distSrtContent = parser.toSrt(srcSubtitles) // Convert to SRT
  await fs.writeFile(distSrtPath, distSrtContent)

  return {
    distSrtPath,
  }
}

// export const translateSrtByOpenai = async ({
//   // eslint-disable-next-line @typescript-eslint/no-unused-vars
//   config,
//   srcSrtPath,
//   distSrtPath,
//   srcLang,
//   distLang,
//   verbose,
//   force,
// }: {
//   config: Config
//   srcSrtPath: string
//   distSrtPath?: string
//   srcLang?: string
//   distLang: string
//   verbose?: boolean
//   force?: boolean
// }) => {
//   verbose && log.normal('Translating srt', { srcSrtPath, distLang })
//   const parsed = parseFileName(srcSrtPath)
//   if (parsed.ext !== 'srt') {
//     throw new Error('Only srt files are allowed')
//   }
//   if (!srcLang) {
//     if (parsed.langSingle) {
//       srcLang = parsed.langSingle
//     } else {
//       throw new Error('srcLang not found')
//     }
//   }
//   distSrtPath = distSrtPath || path.resolve(parsed.dirname, `${parsed.name}.${distLang}.srt`)
//   const { fileExists } = isFileExistsSync({ filePath: distSrtPath })
//   if (fileExists && !force) {
//     verbose && log.normal('Audio file already exists', { distSrtPath })
//     return { distSrtPath }
//   }

//   const langsNames = {
//     en: 'English',
//     ru: 'Russian',
//   }
//   const srcLangName = (langsNames as any)[srcLang] as string
//   const distLangName = (langsNames as any)[distLang] as string
//   if (!srcLangName || !distLangName) {
//     throw new Error('Language name not found')
//   }

//   // Too bad
//   // const srcSrtContent = await fs.readFile(srcSrtPath, 'utf8')
//   // const resRaw = await completionByOpenai<string>({
//   //   systemPrompt: `Act as SRT files translator.
//   // Translate subtitles provided by user from ${srcLangName} to ${distLangName}.
//   // The subtitles are in the SRT format.
//   // Keep the original formatting.
//   // Keep the original timestamps.
//   // Reply ONLY with the translated subtitles.
//   // Your response should be in the SRT format.`,
//   //   userPrompt: srcSrtContent,
//   // })
//   // const res = resRaw.replace(/^```srt\n/, '').replace(/\n```$/, '')
//   // await fs.writeFile(distSrtPath, res)

//   // Some experiments
//   //   const parser = new SrtParser()
//   //   const subtitles = parser.fromSrt(srcSrtContent) // Parse SRT
//   //   const subtitlesTexts = subtitles.map((subtitle) => subtitle.text.replaceAll('\n', ' '))
//   //   const resRaw = await completionByOpenai<string>({
//   //     systemPrompt: `Act as subtitles translator.
//   // Translate subtitles provided by user from ${srcLangName} to ${distLangName}.
//   // STRONGLY Keep the original count of strings: ${subtitles.length}.
//   // REPLY with only the translated subtitles, WITHOUT additional information, comments, etc.
//   // `,
//   //     // userPrompt: JSON.stringify(subtitlesTexts, null, 2),
//   //     // userPrompt: subtitlesTexts.join('\n----------------\n'),
//   //     userPrompt: subtitlesTexts.join('\n'),
//   //     // jsonSchema: {
//   //     //   type: 'array',
//   //     //   items: {
//   //     //     type: 'string',
//   //     //   },
//   //     //   minItems: subtitles.length,
//   //     //   maxItems: subtitles.length,
//   //     // },
//   //     // zodSchema: z.array(z.string()).length(subtitles.length),
//   //     zodSchema: z.object({ structuredResponse: z.array(z.string()).length(subtitles.length) }),
//   //   })
//   //   // const res = resRaw.trim().split('\n')
//   //   // if (!res || res.length !== subtitles.length) {
//   //   //   throw new Error('Subtitles count mismatch')
//   //   // }
//   //   console.log(555, resRaw)
//   //   const res = resRaw
//   //   for (const [i, subtitle] of subtitles.entries()) {
//   //     subtitle.text = res[i]
//   //   }
//   //   const distSrtContent = parser.toSrt(subtitles) // Convert to SRT
//   //   await fs.writeFile(distSrtPath, distSrtContent)

//   const srcSrtContent = await fs.readFile(srcSrtPath, 'utf8')
//   const parser = new SrtParser()
//   const subtitles = parser.fromSrt(srcSrtContent) // Parse SRT
//   const subtitlesTexts = subtitles.map((subtitle) => subtitle.text.replaceAll('\n', ' '))
//   const resRaw = await completionByOpenai<string>({
//     systemPrompt: `Act as subtitles translator.
//   Translate subtitles provided by user from ${srcLangName} to ${distLangName}.
//   `,
//     // userPrompt: JSON.stringify(subtitlesTexts, null, 2),
//     // userPrompt: subtitlesTexts.join('\n----------------\n'),
//     userPrompt: subtitlesTexts.join('\n'),
//     jsonSchema: {
//       type: 'object',
//       properties: {
//         ...subtitlesTexts.map((text, i) => ({})),
//       },
//       required: ['structuredResponse'],
//       additionalProperties: false,
//     },
//     // zodSchema: z.array(z.string()).length(subtitles.length),
//     zodSchema: z.object({ structuredResponse: z.array(z.string()).length(subtitles.length) }),
//   })
//   // const res = resRaw.trim().split('\n')
//   // if (!res || res.length !== subtitles.length) {
//   //   throw new Error('Subtitles count mismatch')
//   // }
//   console.log(555, resRaw)
//   const res = resRaw
//   for (const [i, subtitle] of subtitles.entries()) {
//     subtitle.text = res[i]
//   }
//   const distSrtContent = parser.toSrt(subtitles) // Convert to SRT
//   await fs.writeFile(distSrtPath, distSrtContent)

//   return {
//     distSrtPath,
//   }
// }
