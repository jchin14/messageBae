// Version scheme: MAJOR.YY.N
//   MAJOR: 0 = beta, 1 = first release, 2 = next big update
//   YY:    two-digit year, e.g. 26
//   N:     increments on every bump; resets to 1 on a new year or major
// Usage: npm run bump          -> next N
//        npm run bump major    -> next MAJOR
const fs = require('fs');
const { execSync } = require('child_process');

const p = require('../package.json');
const [major, yy, n] = p.version.split('.').map(Number);
const year = new Date().getFullYear() % 100;

let next;
if (process.argv[2] === 'major') next = [major + 1, year, 1];
else if (yy !== year) next = [major, year, 1];
else next = [major, year, n + 1];

p.version = next.join('.');
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
execSync(`git commit -qm "Bump version to ${p.version}" package.json`);
console.log(p.version);
