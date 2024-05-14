import svagJestConfigBase from 'svag-jest/configs/base.js'
import { pathsToModuleNameMapper } from 'ts-jest'
import tsconfigData from './tsconfig.json' with { type: 'json' }
/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  ...svagJestConfigBase,
  ...(!!tsconfigData.compilerOptions?.paths && {
    moduleNameMapper: pathsToModuleNameMapper(tsconfigData.compilerOptions.paths, { prefix: '<rootDir>/' }),
  }),
}
