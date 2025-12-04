const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter(f => f.startsWith('revisit_time_slot_missing_') && f.endsWith('.html'));
const latest = files.sort().pop();
const filePath = path.join(__dirname, latest);

console.log(`Reading ${filePath}`);
const content = fs.readFileSync(filePath, 'utf8');
const regex = /<[^>]*>10:00<\/[^>]*>/g;
const match = content.match(regex);

if (match) {
  console.log('Found matches:', match);
} else {
  console.log('10:00 element not found via regex');
}
