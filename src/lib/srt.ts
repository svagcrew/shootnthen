/* eslint-disable radix */
import type { Config } from '@/lib/config.js'
import { addSuffixToFilePath } from '@/lib/utils.js'
import { promises as fs } from 'fs'
import path from 'path'
import SrtParser from 'srt-parser-2'

// Helper function to convert time string to milliseconds
export const timeStringToMilliseconds = (timeString: string): number => {
  // Format HH:MM:SS,mmm
  const [hours, minutes, rest] = timeString.split(':')
  const [seconds, milliseconds] = rest.replace(',', '.').split('.')
  const totalMs =
    parseInt(hours) * 3_600_000 + parseInt(minutes) * 60_000 + parseInt(seconds) * 1_000 + parseInt(milliseconds)
  return totalMs
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

type Subtitle = {
  id: string
  startTime: string
  startSeconds: number
  endTime: string
  endSeconds: number
  text: string
}

type Part = {
  durationMs: number
  type: 'speach' | 'gap'
  text: string
}

const subtitlesToParts = ({ subtitles }: { subtitles: Subtitle[] }) => {
  const parts: Part[] = []

  let prevEndMs = 0

  for (const subtitle of subtitles) {
    const text = subtitle.text.replaceAll('\n', ' ')

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
      parts.push({
        text: '',
        durationMs: gapMs,
        type: 'gap',
      })
    }

    prevEndMs = endMs
    parts.push({
      text,
      durationMs: desiredDurationMs,
      type: 'speach',
    })
  }

  return parts
}

const reorganizeParts = ({
  parts,
  minSpeachDurationMs,
  maxSpeachDurationMs,
  maxGapDurationMs,
}: {
  parts: Part[]
  minSpeachDurationMs: number
  maxSpeachDurationMs: number
  maxGapDurationMs: number
}) => {
  // it should create new ttsTasksParts array
  // there should be same ttsTasksParts but without breaks of sentences.
  // if sentence is too long, it should be splitted to parts (maxGapDurationMs, criticalMaxSpeachDurationMs)
  // if gap is too long, it should be in his own part
  // if part is too short it should be merged with next part

  const newParts: Part[] = []

  let currentTtsTaskPart: Part = {
    durationMs: 0,
    type: 'speach',
    text: '',
  }
  const nextTtsTaskPart = () => {
    newParts.push(currentTtsTaskPart)
    currentTtsTaskPart = {
      durationMs: 0,
      type: 'speach',
      text: '',
    }
  }
  const appendCurrentTtsTaskPart = (ttsTaskPart: Part) => {
    currentTtsTaskPart.durationMs += ttsTaskPart.durationMs
    currentTtsTaskPart.text = (currentTtsTaskPart.text + ' ' + ttsTaskPart.text).trim()
  }

  for (const [i, ttsTaskPart] of parts.entries()) {
    if (ttsTaskPart.type === 'gap') {
      const isLastPart = i === parts.length - 1
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
  const lastTtsTaskPart = newParts[newParts.length - 1]
  if (lastTtsTaskPart.durationMs === 0) {
    newParts.pop()
  }
  return newParts
}

const subtitlesToOrganizedParts = ({ subtitles }: { subtitles: Subtitle[] }) => {
  const initialParts = subtitlesToParts({
    subtitles,
  })
  // console.dir({ initialParts }, { depth: null })
  const reorganizedParts = reorganizeParts({
    parts: initialParts,
    minSpeachDurationMs: 3_000,
    maxSpeachDurationMs: 15_000,
    maxGapDurationMs: 2_000,
  })
  // console.dir({ reorganizedParts }, { depth: null })
  // if (1) throw new Error('Not implemented')
  return reorganizedParts
}

const partsToSubtitles = ({ parts }: { parts: Part[] }) => {
  const subtitles: Subtitle[] = []

  let prevEndMs = 0
  let counter = 1

  for (const part of parts) {
    const text = part.text

    const startMs = prevEndMs
    const endMs = startMs + part.durationMs

    const startTime = new Date(startMs).toISOString().slice(11, -1).replaceAll('.', ',')
    const endTime = new Date(endMs).toISOString().slice(11, -1).replaceAll('.', ',')

    prevEndMs = endMs

    if (part.type === 'gap') {
      continue
    }

    subtitles.push({
      id: String(counter++),
      startTime,
      startSeconds: startMs / 1_000,
      endTime,
      endSeconds: endMs / 1_000,
      text,
    })
  }

  return subtitles
}

export const prettifySrtContent = async ({ srtContent }: { srtContent: string }) => {
  const srcSrtContent = srtContent
  const parser = new SrtParser()
  const srcSubtitles = parser.fromSrt(srcSrtContent)

  const parts = subtitlesToOrganizedParts({
    subtitles: srcSubtitles,
  })

  const distSubtitles = partsToSubtitles({
    parts,
  })
  const distSrtContent = parser.toSrt(distSubtitles)
  return distSrtContent
}

export const prettifySrt = async ({
  config,
  srtName,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  verbose,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  force,
}: {
  config: Config
  srtName: string
  verbose?: boolean
  force?: boolean
}) => {
  const srtPath = path.resolve(config.contentDir, srtName)
  const srtBakPath = addSuffixToFilePath({ filePath: srtPath, suffix: 'bak' })
  await fs.copyFile(srtPath, srtBakPath)
  const srcSrtContent = await fs.readFile(srtPath, 'utf8')
  const distSrtContent = await prettifySrtContent({
    srtContent: srcSrtContent,
  })
  await fs.writeFile(srtPath, distSrtContent)
  await fs.unlink(srtBakPath)

  return { srtPath }
}
