import 'source-map-support/register'

export { type Config, getConfig } from '@/lib/config'
export { applyAudiosToVideo, extractAudio } from '@/lib/editor'
export { elevenlabs } from '@/lib/elevenlabs'
export { removeVideosAndAudios } from '@/lib/fs'
export { googleDrive } from '@/lib/googledrive'
export { kinescope } from '@/lib/kinescope'
