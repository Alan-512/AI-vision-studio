const fs = require('fs');

function deleteRanges(file, ranges) {
    let lines = fs.readFileSync(file, 'utf8').split('\n');
    ranges.sort((a, b) => b[0] - a[0]);
    for (let [start, end] of ranges) {
        if (lines[start - 2] === '') { start--; } // remove preceding empty line if exists
        lines.splice(start - 1, end - start + 1);
    }
    fs.writeFileSync(file, lines.join('\n'));
}

deleteRanges('services/memoryService.ts', [
    [644, 689],
    [580, 584],
    [551, 555],
    [426, 455]
]);

deleteRanges('utils/memoryMarkdown.ts', [
    [324, 344],
    [294, 322],
    [270, 292],
    [243, 268],
    [235, 241]
]);

deleteRanges('utils/memoryPatch.ts', [
    [355, 410],
    [332, 353],
    [288, 330],
    [239, 286],
    [216, 237],
    [198, 214],
    [36, 48]
]);

let patchText = fs.readFileSync('utils/memoryPatch.ts', 'utf8');
patchText = patchText.replace(/,\s*MemorySectionItem/g, '');
fs.writeFileSync('utils/memoryPatch.ts', patchText);
console.log('Fixed TS errors.');
