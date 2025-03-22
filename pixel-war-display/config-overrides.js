module.exports = function override(config, env) {
    if (env === 'production') {
        config.devtool = false;
    }
    config.resolve.fallback = {
      ...config.resolve.fallback,
      crypto: require.resolve('crypto-browserify'),
      stream: require.resolve('stream-browserify'),
      http: require.resolve('stream-http'),
      https: require.resolve('https-browserify'),
      zlib: require.resolve('browserify-zlib'),
      url: require.resolve('url'),
    };
    return config;
  };