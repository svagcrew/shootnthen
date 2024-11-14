import 'source-map-support/register.js'

export { type Config, getConfig } from '@/lib/config.js'
export { applyAudiosToVideo, extractAudio } from '@/lib/editor.js'
export { elevenlabs } from '@/lib/elevenlabs.dubbing.js'
export { removeVideosAndAudios } from '@/lib/fs.js'
export { googleDrive } from '@/lib/googledrive.js'
export { kinescope } from '@/lib/kinescope.js'
