const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter(f => f.startsWith('revisit_time_slot_missing_') && f.endsWith('.html'));
const latest = files.sort().pop();
const filePath = path.join(__dirname, latest);

console.log(`Reading ${filePath}`);
const content = fs.readFileSync(filePath, 'utf8');
const index = content.indexOf('10:00');

if (index !== -1) {
    const start = Math.max(0, index - 200);
    const end = Math.min(content.length, index + 200);
    console.log(content.substring(start, end));
} else {
    console.log('10:00 not found');
}
