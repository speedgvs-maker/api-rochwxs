module.exports = {
  apps: [{
    name: 'api-rochwxs',
    script: 'index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
    },
  }],
};
