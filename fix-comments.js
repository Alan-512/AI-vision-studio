const fs = require('fs');

function removeBrokenComments(file) {
  let lines = fs.readFileSync(file, 'utf8').split('\n');
  lines = lines.filter(line => line.trim() !== '/**');
  fs.writeFileSync(file, lines.join('\n'));
}

removeBrokenComments('utils/memoryMarkdown.ts');
removeBrokenComments('utils/memoryPatch.ts');
console.log('Fixed comments.');
