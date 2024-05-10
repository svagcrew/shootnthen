import { Config } from '@/exports'
import { replaceIllegalSymbolsFromFileName } from '@/lib/fs'
import { getMetaByFilePath, updateMeta } from '@/lib/meta'
import { Lang } from '@/lib/utils'
import axios, { isAxiosError } from 'axios'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream'
import { log } from 'svag-cli-utils'
import util from 'util'
const streamPipeline = util.promisify(pipeline)

const fileBaseNameByTitleAndLang = ({ title, lang }: { title: string; lang?: Lang }) => {
  const langSuffix = lang ? `.${lang}` : ''
  return replaceIllegalSymbolsFromFileName(title).replaceAll('.', '_') + langSuffix + '.mp4'
}

const downloadVideoByPublicUrl = async ({
  loomPublicUrl,
  filePath,
  title,
  config,
  lang,
  force,
  verbose,
}: {
  loomPublicUrl: string
  filePath?: string
  title?: string
  config: Config
  lang?: Lang
  force?: boolean
  verbose?: boolean
}) => {
  verbose && log.normal(`Downloading loom video from ${loomPublicUrl}`)
  const loomTitle = (await getVideoTitleByPublicUrl({ loomPublicUrl })).title
  title = title || loomTitle
  const filePathAbs = (() => {
    if (filePath) {
      return path.resolve(config.contentDir, filePath)
    } else {
      return path.resolve(config.contentDir, fileBaseNameByTitleAndLang({ title: loomTitle, lang }))
    }
  })()
  const { meta, metaFilePath } = getMetaByFilePath({ filePath: filePathAbs, config })
  const loomPublicUrlParsed = new URL(loomPublicUrl)
  const loomId = loomPublicUrlParsed.pathname.split('/').pop()
  if (!loomId) {
    throw new Error(`No loom id found in ${loomPublicUrl}`)
  }
  const exRecordBefore = meta.loom.videos.find((v) => v.id === loomId)
  if (exRecordBefore && !force) {
    verbose && log.normal(`Loom video already downloaded to ${exRecordBefore.filePath}`)
    return { filePath: exRecordBefore.filePath, title: exRecordBefore.title }
  }
  const res = await (async () => {
    try {
      return await axios({
        method: 'post',
        url: `https://www.loom.com/api/campaigns/sessions/${loomId}/transcoded-url`,
        headers: {},
      })
    } catch (err) {
      if (isAxiosError(err) && err.response?.data) {
        throw new Error(JSON.stringify(err.response.data, null, 2))
      }
      throw err
    }
  })()
  const loomDownloadUrl = res.data.url
  if (!loomDownloadUrl) {
    throw new Error(`No download url, ${JSON.stringify(res.data, null, 2)}`)
  }
  await (async () => {
    try {
      const response = await axios({
        method: 'get',
        url: loomDownloadUrl,
        responseType: 'stream',
      })
      await streamPipeline(response.data, fs.createWriteStream(filePathAbs))
      return response
    } catch (err) {
      if (isAxiosError(err)) {
        throw new Error(JSON.stringify(err.response?.data, null, 2))
      }
      throw err
    }
  })()
  const exRecord = meta.loom.videos.find((v) => v.id === loomId)
  if (!meta.title) {
    meta.title = title
  }
  if (!exRecord) {
    meta.loom.videos.push({ id: loomId, url: loomPublicUrl, title: loomTitle, filePath: filePathAbs })
  } else {
    exRecord.filePath = filePathAbs
    exRecord.url = loomPublicUrl
    exRecord.title = loomTitle
  }
  updateMeta({ meta, metaFilePath })
  verbose && log.normal(`Downloaded loom video to ${filePathAbs}`)
  return {
    filePath: filePathAbs,
    title,
  }
}

const getVideoTitleByPublicUrl = async ({ loomPublicUrl }: { loomPublicUrl: string }) => {
  const res = await (async () => {
    try {
      return await axios({
        method: 'get',
        url: loomPublicUrl,
      })
    } catch (err) {
      if (isAxiosError(err) && err.response?.data) {
        throw new Error(JSON.stringify(err.response.data, null, 2))
      }
      throw err
    }
  })()
  const titleRaw = res.data.match(/<title>(.*)<\/title>/)?.[1] as string
  if (!titleRaw) {
    throw new Error(`No title found in ${loomPublicUrl}`)
  }
  const title = titleRaw.replace(/ \| Loom$/, '')
  return { title }
}

export const loom = {
  downloadVideoByPublicUrl,
}
