const fs = require('fs');

const html = fs.readFileSync('page_dump.html', 'utf8');
const index = html.indexOf('최장혁');

if (index !== -1) {
    console.log('Found "최장혁" at index ' + index);
    const start = Math.max(0, index - 500);
    const end = Math.min(html.length, index + 500);
    console.log('--- CONTEXT ---');
    console.log(html.substring(start, end));
    console.log('---------------');
} else {
    console.log('Name not found in dump.');
}
