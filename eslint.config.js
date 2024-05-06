const getSvagEslintBaseConfigs = require('svag-lint/configs/node')
/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [...getSvagEslintBaseConfigs()]
