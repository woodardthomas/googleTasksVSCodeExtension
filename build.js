const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file if it exists (for local development)
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf-8');
  for (const line of envConfig.split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      // Remove surrounding quotes if present
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.substring(1, value.length - 1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

const isWatch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: ['./src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  minify: !isWatch,
  define: {
    'process.env.GOOGLE_CLIENT_ID': JSON.stringify(process.env.GOOGLE_CLIENT_ID || ''),
    'process.env.GOOGLE_CLIENT_SECRET': JSON.stringify(process.env.GOOGLE_CLIENT_SECRET || ''),
  }
};

if (isWatch) {
  console.log('Watching for changes...');
  esbuild.context(buildOptions).then(ctx => {
    ctx.watch();
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  console.log('Building extension...');
  esbuild.build(buildOptions).then(() => {
    console.log('Build completed successfully.');
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
