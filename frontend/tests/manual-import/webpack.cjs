const path = require('path');
const makeConfig = require('../../build/webpack.config');
module.exports = () => {
  const config = makeConfig({ production: true });
  config.resolve.alias = {};
  config.resolve.alias['Commands/useCommands$'] = path.resolve(__dirname, 'commands.ts');
  config.optimization.minimize = false;
  config.entry = { index: path.resolve(__dirname, 'entry.tsx') };
  config.output.path = path.resolve(__dirname, '../../../_output/manual-import-test');
  config.plugins = config.plugins.filter(plugin => !['FileManagerPlugin', 'ForkTsCheckerWebpackPlugin', 'LiveReloadPlugin'].includes(plugin.constructor.name));
  return config;
};
