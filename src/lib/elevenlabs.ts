/* eslint-disable no-useless-catch */
import { closeBrowser, visitPage } from '@/lib/browser'
import { Config } from '@/lib/config'
import { getEnv } from '@/lib/env'
import { getMetaByFilePath, parseFileName, updateMeta } from '@/lib/meta'
import { LangProcessed } from '@/lib/utils'
import axios, { isAxiosError } from 'axios'
import FormData from 'form-data'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream'
import { isFileExists, log } from 'svag-cli-utils'
import util from 'util'
const streamPipeline = util.promisify(pipeline)

const createDubbing = async ({
  config,
  filePath,
  srcLang,
  distLang,
}: {
  config: Config
  filePath: string
  srcLang: LangProcessed
  distLang: LangProcessed
}) => {
  const filePathAbs = path.resolve(config.contentDir, filePath)
  const { meta, metaFilePath } = getMetaByFilePath({ filePath, config })
  const parsedName = parseFileName(filePath)
  const apiKey = getEnv('ELEVENLABS_API_KEY')
  const projectName = `${parsedName.name}.${distLang}.${parsedName.ext}`
  if (!parsedName.ext || !['mp4', 'mp3'].includes(parsedName.ext)) {
    throw new Error('Only mp4 and mp3 files are allowed')
  }
  const { fileExists } = await isFileExists({ filePath: filePathAbs })
  if (!fileExists) {
    throw new Error('File not found')
  }
  const contentType = parsedName.ext === 'mp4' ? 'video/mp4' : 'audio/mp3'
  const fileSize = fs.statSync(filePathAbs).size
  const file = fs.createReadStream(filePathAbs)

  const data = {
    mode: 'dubbing',
    file,
    name: projectName,
    source_lang: srcLang,
    target_lang: distLang,
    num_speakers: '1',
    highest_resolution: 'true',
  }

  const form = (() => {
    const result = new FormData()
    for (const key in data) {
      if (key === 'file') {
        result.append(key, (data as any)[key], {
          contentType,
          filename: projectName,
          knownLength: fileSize,
        })
      } else {
        result.append(key, (data as any)[key])
      }
    }
    return result
  })()

  const res = await (async () => {
    try {
      return await axios({
        method: 'post',
        url: 'https://api.elevenlabs.io/v1/dubbing',
        headers: {
          ...form.getHeaders(),
          'Content-Type': 'multipart/form-data',
          'xi-api-key': apiKey,
        },
        data: form,
      })
    } catch (err) {
      if (isAxiosError(err)) {
        throw new Error(JSON.stringify(err.response?.data, null, 2))
      }
      throw err
    }
  })()
  const dubbingId = res.data.dubbing_id
  const duration = res.data.expected_duration_sec
  if (!dubbingId) {
    throw new Error('No dubbingId after upload')
  }
  if (!duration) {
    throw new Error('No duration after upload')
  }
  meta.elevenlabs.dubbings.push({
    id: dubbingId,
    duration,
    srcLang,
    distLang,
    distFilePath: null,
    srcFilePath: filePathAbs,
    srcUrl: null,
  })
  updateMeta({ meta, metaFilePath })
  return { dubbingId, duration, srcLang, distLang }
}

const createDubbingByUrl = async ({
  config,
  url,
  filePath, // only for meta creation and ext getter
  srcLang,
  distLang,
}: {
  config: Config
  url: string
  filePath: string
  srcLang: LangProcessed
  distLang: LangProcessed
}) => {
  const { meta, metaFilePath } = getMetaByFilePath({ filePath, config })
  const parsedName = parseFileName(filePath)
  const apiKey = getEnv('ELEVENLABS_API_KEY')
  const projectName = `${parsedName.name}.${distLang}.${parsedName.ext}`
  if (!parsedName.ext || !['mp4', 'mp3'].includes(parsedName.ext)) {
    throw new Error('Only mp4 and mp3 files are allowed')
  }

  const data = {
    mode: 'dubbing',
    source_url: url,
    name: projectName,
    source_lang: srcLang,
    target_lang: distLang,
    num_speakers: '1',
    highest_resolution: 'true',
  }

  const form = (() => {
    const result = new FormData()
    for (const key in data) {
      result.append(key, (data as any)[key])
    }
    return result
  })()

  const res = await (async () => {
    try {
      return await axios({
        method: 'post',
        url: 'https://api.elevenlabs.io/v1/dubbing',
        headers: {
          ...form.getHeaders(),
          'Content-Type': 'multipart/form-data',
          'xi-api-key': apiKey,
        },
        data: form,
      })
    } catch (err) {
      if (isAxiosError(err)) {
        throw new Error(JSON.stringify(err.response?.data, null, 2))
      }
      throw err
    }
  })()
  const dubbingId = res.data.dubbing_id
  const duration = res.data.expected_duration_sec
  if (!dubbingId) {
    throw new Error('No dubbingId after upload')
  }
  if (!duration && duration !== 0) {
    throw new Error('No duration after upload')
  }
  meta.elevenlabs.dubbings.push({
    id: dubbingId,
    duration,
    srcLang,
    distLang,
    distFilePath: null,
    srcFilePath: null,
    srcUrl: url,
  })
  updateMeta({ meta, metaFilePath })
  return { dubbingId, duration, srcLang, distLang }
}

const getDubbing = async ({ dubbingId, verbose }: { dubbingId: string; verbose?: boolean }) => {
  verbose && log.normal('Getting dubbing', dubbingId)
  const apiKey = getEnv('ELEVENLABS_API_KEY')
  const res = await (async () => {
    try {
      return await axios({
        method: 'get',
        url: `https://api.elevenlabs.io/v1/dubbing/${dubbingId}`,
        headers: {
          'xi-api-key': apiKey,
        },
      })
    } catch (err) {
      if (isAxiosError(err)) {
        throw new Error(JSON.stringify(err.response?.data, null, 2))
      }
      throw err
    }
  })()
  const error = res.data.error
  const name = res.data.name
  const status = res.data.status
  const targetLangs = res.data.target_languages
  if (!name) {
    throw new Error('No name in response')
  }
  if (!status) {
    throw new Error('No status in response')
  }
  if (!targetLangs) {
    throw new Error('No targetLangs in response')
  }
  const result = { name, status, targetLangs, error }
  verbose && log.normal('Got dubbing', result)
  return result as {
    name: string
    status: 'dubbing' | 'dubbed'
    targetLangs: string[]
    error: string | undefined | null
  }
}

const waitUntilDubbed = async ({
  dubbingId,
  verbose,
}: {
  dubbingId: string
  verbose?: boolean
}): Promise<{
  name: string
  status: 'dubbed'
  targetLangs: string[]
  error: string | undefined | null
}> => {
  const result = await getDubbing({ dubbingId, verbose })
  if (result.status === 'dubbed') {
    verbose && log.normal('Dubbed', result)
    return { ...result, status: 'dubbed' }
  }
  if (result.status !== 'dubbing') {
    throw new Error(`Unexpected status: ${result.status} ${JSON.stringify(result)}`)
  }
  verbose && log.normal('Waiting for dubbing', dubbingId)
  await wait(10)
  const awaitedResult = await waitUntilDubbed({ dubbingId })
  verbose && log.normal('Dubbed', result)
  return awaitedResult
}

const downloadDubbing = async ({
  config,
  dubbingId,
  lang,
  filePath,
  verbose,
}: {
  config: Config
  dubbingId: string
  lang: LangProcessed
  filePath: string
  verbose?: boolean
}) => {
  verbose && log.normal('Downloading dubbing', dubbingId, lang)
  const filePathAbs = path.resolve(config.contentDir, filePath)
  const { meta, metaFilePath } = getMetaByFilePath({ filePath, config })
  const apiKey = getEnv('ELEVENLABS_API_KEY')

  await (async () => {
    try {
      const response = await axios({
        method: 'get',
        url: `https://api.elevenlabs.io/v1/dubbing/${dubbingId}/audio/${lang}`,
        headers: {
          'xi-api-key': apiKey,
        },
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

  const exRecord = meta.elevenlabs.dubbings.find((dubbing) => dubbing.id === dubbingId)
  if (exRecord) {
    exRecord.distFilePath = filePathAbs
    updateMeta({ meta, metaFilePath })
  }
  verbose && log.normal('Downloaded dubbing', dubbingId, lang)
  return {
    filePath: filePathAbs,
  }
}

const authorize = async ({ verbose }: { verbose?: boolean } = {}) => {
  const email = getEnv('ELEVENLABS_EMAIL')
  const password = getEnv('ELEVENLABS_PASSWORD')
  let page = await visitPage('https://elevenlabs.io/app/dubbing')

  const dubbingProjectNameInputSelector = '[aria-label="Dubbing Project Name (Optional)"]'
  verbose && log.normal('Checking if already authorized')
  const signInButtonSelector = '[data-testid="sign-in-button"]'
  try {
    await page.waitForSelector(signInButtonSelector)
  } catch (err) {
    try {
      await page.waitForSelector(dubbingProjectNameInputSelector)
      verbose && log.normal('Already authorized')
      return
    } catch (err) {
      throw new Error('No account button and no sign in button')
    }
  }
  const signInButton = await page.$(signInButtonSelector)
  if (!signInButton) {
    throw new Error('No sign in button')
  }
  verbose && log.normal('Start signing in')
  await signInButton.click()

  const emailInputSelector = '[type="email"]'
  const passwordInputSelector = '[type="password"]'
  await page.waitForSelector(emailInputSelector)
  await page.waitForSelector(passwordInputSelector)

  await page.type(emailInputSelector, email)
  await page.type(passwordInputSelector, password)
  await page.keyboard.press('Enter')

  await wait(5)

  await page.close()
  page = await visitPage('https://elevenlabs.io/app/dubbing')

  try {
    await page.waitForSelector(dubbingProjectNameInputSelector)
    verbose && log.normal('Signed in')
  } catch (err) {
    throw new Error('No dubbing project name input after login')
  }
}

const getNonNullable = <T>(value: T): NonNullable<T> => {
  if (!value) {
    throw new Error('Falsy value')
  }
  return value as NonNullable<T>
}

const wait = async (s: number) => new Promise((resolve) => setTimeout(resolve, s * 1000))

const createDubbingWithBrowser = async ({
  config,
  filePath,
  srcLang,
  distLang,
  verbose,
}: {
  config: Config
  filePath: string
  srcLang: LangProcessed
  distLang: LangProcessed
  verbose?: boolean
}) => {
  try {
    verbose && log.normal('Creating dubbing with browser', filePath, srcLang, distLang)
    const filePathAbs = path.resolve(config.contentDir, filePath)
    const { meta, metaFilePath } = getMetaByFilePath({ filePath, config })
    const parsedName = parseFileName(filePath)
    const projectName = `${parsedName.name}.${distLang}.${parsedName.ext}`
    if (!parsedName.ext || !['mp4', 'mp3'].includes(parsedName.ext)) {
      throw new Error('Only mp4 and mp3 files are allowed')
    }
    const { fileExists } = await isFileExists({ filePath: filePathAbs })
    if (!fileExists) {
      throw new Error('File not found')
    }

    await authorize()
    let page = await visitPage('https://elevenlabs.io/app/dubbing')

    verbose && log.normal('Filling form')

    const dubbingProjectNameInputSelector = '[aria-label="Dubbing Project Name (Optional)"]'
    await page.waitForSelector(dubbingProjectNameInputSelector)
    await page.type(dubbingProjectNameInputSelector, projectName)

    await page.keyboard.press('Tab')
    await wait(1)
    await page.keyboard.press('Tab')
    await wait(1)
    await page.keyboard.press('Enter')
    await wait(1)

    const srcLangFull = getNonNullable(srcLang === 'en' ? 'English' : srcLang === 'ru' ? 'Russian' : null)
    const srcLangOption = getNonNullable(await page.waitForSelector(`[aria-label="${srcLangFull}"]`))
    await srcLangOption.click()

    await wait(1)
    await page.keyboard.press('Tab')
    await wait(1)
    await page.keyboard.press('Tab')
    await wait(1)
    await page.keyboard.press('Enter')
    await wait(1)

    const distLangFull = getNonNullable(distLang === 'en' ? 'English' : distLang === 'ru' ? 'Russian' : null)
    const distLangOption = getNonNullable(await page.waitForSelector(`[aria-label="${distLangFull}"]`))
    await distLangOption.click()
    await wait(1)

    const fileInput = getNonNullable(await page.waitForSelector('input[type="file"]'))
    await fileInput.uploadFile(filePathAbs)
    await wait(1)
    const createButton = getNonNullable(
      await page.waitForSelector(
        'button.flex.items-center.btn.btn-primary.btn-md.btn-normal.flex.items-center.btn.btn-primary.btn-lg.btn-normal.w-full.mt-4.mb-4'
      )
    )
    await createButton.click()
    verbose && log.normal('Waiting dubbing id')

    await wait(5)
    await page.close()
    page = await visitPage('https://elevenlabs.io/app/dubbing')
    await wait(5)

    const projectDubbingNameLabelSelector = `text/${projectName}`
    const projectDubbingNameLabel = getNonNullable(await page.waitForSelector(projectDubbingNameLabelSelector))
    await wait(3)
    await projectDubbingNameLabel.hover()

    const elementWithDubIdSelector = `[data-floating-ui-portal]`
    const elementWithDubId = getNonNullable(await page.waitForSelector(elementWithDubIdSelector))
    const elementWithDubIdText = await elementWithDubId.evaluate((el) => el.innerHTML)
    // elementWithDubIdText = '<div class="relative max-w-[16rem] px-2 py-1.5 text-white bg-black rounded-md" tabindex="-1" id=":ru:" role="tooltip" style="position: absolute; left: 0px; top: 0px; z-index: 1000; transform: translate(353.333px, 1246.67px); transition-property: opacity; transition-duration: 250ms;"><span class="relative z-10 inline-block text-sm leading-tight"><div><span class="">Dub ID: rJiUnxgfxZYkmzEKGG23</span><br><span class="">Charged characters: 578 </span></div></span><span class="absolute bottom-0 w-5 h-5 bg-black" style="left: 50%; transform: translateX(-50%) rotate(45deg);"></span></div>'
    // extract dubid
    const dubbingId = elementWithDubIdText.match(/Dub ID: ([a-zA-Z0-9]+)/)?.[1]
    const duration = 0
    if (!dubbingId) {
      throw new Error('No dubbingId after upload')
    }
    if (!duration && duration !== 0) {
      throw new Error('No duration after upload')
    }
    meta.elevenlabs.dubbings.push({
      id: dubbingId,
      duration,
      srcLang,
      distLang,
      distFilePath: null,
      srcFilePath: filePathAbs,
      srcUrl: null,
    })
    updateMeta({ meta, metaFilePath })
    closeBrowser()
    verbose && log.normal('Dubbing created')
    return { dubbingId, duration, srcLang, distLang }
  } catch (err) {
    // closeBrowser()
    throw err
  }
}

const createWaitDownloadDubbing = async ({
  config,
  srcFilePath,
  distFilePath,
  srcLang,
  distLang,
  verbose,
}: {
  config: Config
  srcFilePath: string
  distFilePath: string
  srcLang: LangProcessed
  distLang: LangProcessed
  verbose?: boolean
}) => {
  const { dubbingId } = await elevenlabs.createDubbingWithBrowser({
    distLang,
    srcLang,
    filePath: srcFilePath,
    config,
    verbose,
  })
  await elevenlabs.waitUntilDubbed({ dubbingId, verbose })
  await elevenlabs.downloadDubbing({
    dubbingId,
    config,
    filePath: distFilePath,
    lang: distLang,
    verbose,
  })
}

export const elevenlabs = {
  waitUntilDubbed,
  createDubbing,
  createDubbingByUrl,
  getDubbing,
  downloadDubbing,
  createDubbingWithBrowser,
  createWaitDownloadDubbing,
}
