import 'source-map-support/register'

import { getConfig } from '@/lib/config'
import { getEnv, validateEnv } from '@/lib/env'
import dedent from 'dedent'
import { defineCliApp, log } from 'svag-cli-utils'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
defineCliApp(async ({ cwd, command, args, argr, flags }) => {
  validateEnv()
  const { config } = await getConfig({
    dirPath: cwd,
  })

  switch (command) {
    case 'c': {
      log.black(JSON.stringify(config, null, 2))
      break
    }
    case 'e': {
      log.black(getEnv('OPENAI_API_KEY'))
      break
    }
    case 'h': {
      log.black(dedent`Commands:
        e - show env OPENAI_API_KEY
        c - show config
        h — help
        `)
      break
    }
    default: {
      log.red('Unknown command:', command)
      break
    }
  }
})
