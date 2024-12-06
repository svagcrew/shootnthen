import { timeStringToMilliseconds } from '@/lib/srt.js'

type Subtitle = {
  id: string
  startTime: string
  startSeconds: number
  endTime: string
  endSeconds: number
  text: string
}

export type TtsTask = {
  ssml: string
  text: string
  durationMs: number
  type: 'speach' | 'gap'
  voiceName: string
  lang: string
}

type TtsTaskPart = {
  durationMs: number
  type: 'speach' | 'gap'
  voiceName: string
  text: string
  lang: string
}

type TtsTaskPartsGroup = {
  durationMs: number
  type: 'speach' | 'gap'
  ttsTaskParts: TtsTaskPart[]
}

// Helper function to escape XML special characters
const escapeXml = (unsafe: string): string => {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\n/g, ' ')
}

const subtitlesToTtsTasksParts = ({
  desiredTotalDurationMs,
  subtitles,
  voiceName,
  lang,
}: {
  desiredTotalDurationMs: number
  subtitles: Subtitle[]
  voiceName: string
  lang: string
}): TtsTaskPart[] => {
  const ttsTasksParts: TtsTaskPart[] = []

  let currentTotalDurationMs = 0
  let prevEndMs = 0

  for (const subtitle of subtitles) {
    const text = subtitle.text

    const startTime = subtitle.startTime // in format HH:MM:SS,mmm
    const endTime = subtitle.endTime

    // Convert startTime and endTime to milliseconds
    const startMs = timeStringToMilliseconds(startTime)
    const endMs = timeStringToMilliseconds(endTime)

    // Calculate gap from previous end to current start
    const gapMs = startMs - prevEndMs

    // Calculate the desired duration for this subtitle
    const desiredDurationMs = endMs - startMs

    if (gapMs > 0) {
      currentTotalDurationMs += gapMs
      ttsTasksParts.push({
        text: '',
        durationMs: gapMs,
        type: 'gap',
        voiceName,
        lang,
      })
    }

    prevEndMs = endMs
    currentTotalDurationMs += desiredDurationMs
    ttsTasksParts.push({
      text,
      durationMs: desiredDurationMs,
      type: 'speach',
      voiceName,
      lang,
    })
  }

  const remainingDurationMs = desiredTotalDurationMs - currentTotalDurationMs
  if (remainingDurationMs > 0) {
    ttsTasksParts.push({
      text: '',
      durationMs: remainingDurationMs,
      type: 'gap',
      voiceName,
      lang,
    })
  }
  return ttsTasksParts
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const reorganizeTtsTasksParts = ({
  ttsTasksParts,
  minSpeachDurationMs,
  maxSpeachDurationMs,
  maxGapDurationMs,
}: {
  ttsTasksParts: TtsTaskPart[]
  minSpeachDurationMs: number
  maxSpeachDurationMs: number
  maxGapDurationMs: number
}) => {
  // it should create new ttsTasksParts array
  // there should be same ttsTasksParts but without breaks of sentences.
  // if sentence is too long, it should be splitted to parts (maxGapDurationMs, criticalMaxSpeachDurationMs)
  // if gap is too long, it should be in his own part
  // if part is too short it should be merged with next part

  const newTtsTasksParts: TtsTaskPart[] = []

  let currentTtsTaskPart: TtsTaskPart = {
    durationMs: 0,
    type: 'speach',
    voiceName: ttsTasksParts[0].voiceName,
    text: '',
    lang: ttsTasksParts[0].lang,
  }
  const nextTtsTaskPart = () => {
    newTtsTasksParts.push(currentTtsTaskPart)
    currentTtsTaskPart = {
      durationMs: 0,
      type: 'speach',
      voiceName: ttsTasksParts[0].voiceName,
      text: '',
      lang: ttsTasksParts[0].lang,
    }
  }
  const appendCurrentTtsTaskPart = (ttsTaskPart: TtsTaskPart) => {
    currentTtsTaskPart.durationMs += ttsTaskPart.durationMs
    currentTtsTaskPart.text = (currentTtsTaskPart.text + ' ' + ttsTaskPart.text).trim()
  }

  for (const [i, ttsTaskPart] of ttsTasksParts.entries()) {
    if (ttsTaskPart.type === 'gap') {
      const isLastPart = i === ttsTasksParts.length - 1
      const isFirstPart = i === 0
      if (isLastPart) {
        nextTtsTaskPart()
        currentTtsTaskPart = ttsTaskPart
        nextTtsTaskPart()
        continue
      } else if (isFirstPart) {
        currentTtsTaskPart = ttsTaskPart
        nextTtsTaskPart()
        continue
      } else if (currentTtsTaskPart.durationMs === 0) {
        currentTtsTaskPart = ttsTaskPart
        nextTtsTaskPart()
        continue
      } else if (ttsTaskPart.durationMs > maxGapDurationMs) {
        nextTtsTaskPart()
        currentTtsTaskPart = ttsTaskPart
        nextTtsTaskPart()
        continue
      }
    }

    const itIsEndOfSentence = isEndOfSentence(ttsTaskPart.text)
    if (!itIsEndOfSentence) {
      const nextDurationMs = currentTtsTaskPart.durationMs + ttsTaskPart.durationMs
      if (nextDurationMs > maxSpeachDurationMs) {
        nextTtsTaskPart()
        currentTtsTaskPart = ttsTaskPart
        continue
      } else {
        appendCurrentTtsTaskPart(ttsTaskPart)
        continue
      }
    }

    appendCurrentTtsTaskPart(ttsTaskPart)
    const isTooShort = currentTtsTaskPart.durationMs < minSpeachDurationMs
    if (isTooShort) {
      continue
    } else {
      nextTtsTaskPart()
      continue
    }
  }
  nextTtsTaskPart()
  const lastTtsTaskPart = newTtsTasksParts[newTtsTasksParts.length - 1]
  if (lastTtsTaskPart.durationMs === 0) {
    newTtsTasksParts.pop()
  }
  return newTtsTasksParts
}

const isEndOfSentence = (text: string) => {
  return (
    text.endsWith('.') ||
    text.endsWith('!') ||
    text.endsWith('?') ||
    text.endsWith(';') ||
    text.endsWith(')') ||
    text.endsWith(']')
  )
}

const groupTtsTasksParts = ({
  ttsTasksParts,
  maxSpeachDurationMs,
  criticalMaxSpeachDurationMs,
  maxGapDurationMs,
  separateSentences,
}: {
  ttsTasksParts: TtsTaskPart[]
  maxSpeachDurationMs: number
  criticalMaxSpeachDurationMs: number
  maxGapDurationMs: number
  separateSentences?: boolean
}) => {
  // if gap is too long, add it to own group
  // group speaches and gaps to chunks
  const ttsTasksPartsGroups: TtsTaskPartsGroup[] = []

  let currentGroup: TtsTaskPartsGroup = {
    durationMs: 0,
    type: 'speach',
    ttsTaskParts: [],
  }
  const nextGroup = () => {
    ttsTasksPartsGroups.push(currentGroup)
    currentGroup = {
      durationMs: 0,
      type: 'speach',
      ttsTaskParts: [],
    } as TtsTaskPartsGroup
  }

  for (const ttsTaskPart of ttsTasksParts) {
    if (ttsTaskPart.type === 'gap' && ttsTaskPart.durationMs > maxGapDurationMs) {
      if (currentGroup.ttsTaskParts.length === 0) {
        currentGroup.type = 'gap'
        currentGroup.durationMs = ttsTaskPart.durationMs
        currentGroup.ttsTaskParts.push(ttsTaskPart)
        nextGroup()
        continue
      } else {
        nextGroup()
        currentGroup.type = 'gap'
        currentGroup.durationMs = ttsTaskPart.durationMs
        currentGroup.ttsTaskParts.push(ttsTaskPart)
        nextGroup()
        continue
      }
    }

    const nextDurationMs = currentGroup.durationMs + ttsTaskPart.durationMs
    const lastTtsTaskPart = currentGroup.ttsTaskParts.length
      ? currentGroup.ttsTaskParts[currentGroup.ttsTaskParts.length - 1]
      : null
    const itIsEndOfSentence = lastTtsTaskPart && isEndOfSentence(lastTtsTaskPart.text)
    if (nextDurationMs > maxSpeachDurationMs && itIsEndOfSentence) {
      nextGroup()
    } else if (nextDurationMs > criticalMaxSpeachDurationMs) {
      nextGroup()
    } else if (separateSentences && itIsEndOfSentence) {
      nextGroup()
    }
    currentGroup.durationMs += ttsTaskPart.durationMs
    currentGroup.ttsTaskParts.push(ttsTaskPart)
  }
  nextGroup()
  const lastGroup = ttsTasksPartsGroups[ttsTasksPartsGroups.length - 1]
  if (lastGroup.ttsTaskParts.length === 0) {
    ttsTasksPartsGroups.pop()
  } else if (lastGroup.durationMs === 0) {
    ttsTasksPartsGroups.pop()
  } else if (lastGroup.ttsTaskParts.length === 1 && lastGroup.ttsTaskParts[0].type === 'gap') {
    lastGroup.type = 'gap'
  }
  // console.dir({ ttsTasksPartsGroups }, { depth: null })
  // if (1) throw new Error('Not implemented')
  return ttsTasksPartsGroups
}

const ttsTasksPartsGroupToTtsTask = ({ ttsTasksPartsGroup }: { ttsTasksPartsGroup: TtsTaskPartsGroup }) => {
  const voiceName = ttsTasksPartsGroup.ttsTaskParts[0].voiceName
  const lang = ttsTasksPartsGroup.ttsTaskParts[0].lang
  let ssml = ''
  ssml += `<?xml version="1.0" encoding="UTF-8"?>\n`
  ssml += `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="${lang}">\n`
  ssml += `<voice name="${voiceName}">\n`

  const textParts: string[] = []

  for (const ttsTaskPart of ttsTasksPartsGroup.ttsTaskParts) {
    if (ttsTaskPart.type === 'speach') {
      textParts.push(ttsTaskPart.text)
      ssml += `<prosody duration="${ttsTaskPart.durationMs}ms">${escapeXml(ttsTaskPart.text)}</prosody>\n`
    } else {
      ssml += `<break time="${ttsTaskPart.durationMs}ms"/>\n`
    }
  }

  ssml += `</voice>\n`
  ssml += `</speak>`

  return {
    ssml,
    text: textParts.join(' '),
    durationMs: ttsTasksPartsGroup.durationMs,
    type: ttsTasksPartsGroup.type,
    voiceName,
    lang,
  }
}

const ttsTasksPartsGroupsToTtsTasks = ({ ttsTasksPartsGroups }: { ttsTasksPartsGroups: TtsTaskPartsGroup[] }) => {
  return ttsTasksPartsGroups.map((ttsTasksPartsGroup) => ttsTasksPartsGroupToTtsTask({ ttsTasksPartsGroup }))
}

export const subtitlesToTtsTasks = ({
  desiredTotalDurationMs,
  subtitles,
  voiceName,
  separateSentences,
  lang,
}: {
  desiredTotalDurationMs: number
  subtitles: Subtitle[]
  voiceName: string
  separateSentences?: boolean
  lang: string
}): TtsTask[] => {
  const initialTtsTasksParts = subtitlesToTtsTasksParts({
    desiredTotalDurationMs,
    subtitles,
    voiceName,
    lang,
  })
  // Now we reorganize on extractin text from speach
  // // console.dir({ initialTtsTasksParts }, { depth: null })
  // const reorganizedTtsTasksParts = reorganizeTtsTasksParts({
  //   ttsTasksParts: initialTtsTasksParts,
  //   minSpeachDurationMs: 3_000,
  //   maxSpeachDurationMs: 30_000,
  //   maxGapDurationMs: 2_000,
  // })
  const reorganizedTtsTasksParts = initialTtsTasksParts
  // console.dir({ reorganizedTtsTasksParts }, { depth: null })
  // if (1) throw new Error('Not implemented')
  const ttsTasksPartsGroups = groupTtsTasksParts({
    ttsTasksParts: reorganizedTtsTasksParts,
    criticalMaxSpeachDurationMs: 90_000,
    maxSpeachDurationMs: 30_000,
    maxGapDurationMs: 5_000,
    separateSentences,
    // criticalMaxSpeachDurationMs: 20_000,
    // maxSpeachDurationMs: 10_000,
    // maxGapDurationMs: 2_000,
  })
  const ttsTasks = ttsTasksPartsGroupsToTtsTasks({ ttsTasksPartsGroups })
  return ttsTasks
}
