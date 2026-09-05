const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const files = fs.readdirSync('d:/全网情报系统/tests')
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => path.resolve('d:/全网情报系统/tests', f));
console.log('running', files.length, 'files:', files.map((f) => path.basename(f)).join(', '));
try {
  const out = execSync('node --test ' + files.map((f) => '"' + f + '"').join(' '), {
    encoding: 'utf8', cwd: 'd:/全网情报系统', stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log(out.split('\n').slice(-22).join('\n'));
} catch (e) {
  console.log(e.stdout ? e.stdout.split('\n').slice(-30).join('\n') : e.message);
  process.exit(1);
}
