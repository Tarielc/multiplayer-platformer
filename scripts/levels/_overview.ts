import { coop1, coop2, coop3, coop4 } from './coop';
import { race1, race2, race3 } from './race';
const all = { 'coop-1': coop1, 'coop-2': coop2, 'coop-3': coop3, 'coop-4': coop4, 'race-1': race1, 'race-2': race2, 'race-3': race3 } as const;
const id = process.argv[2] as keyof typeof all;
const sx = Number(process.argv[3] ?? 3), sy = Number(process.argv[4] ?? 2);
const rows = all[id]().rows();
const solid = (c: string) => /[A-Za-z#=%&@$]/.test(c) && !'acspwgCE'.includes(c);
for (let y = 0; y < rows.length; y += sy) {
  let line = '';
  for (let x = 0; x < rows[0]!.length; x += sx) {
    let ch = ' ';
    for (let dy = 0; dy < sy; dy++) for (let dx = 0; dx < sx; dx++) {
      const c = rows[y + dy]?.[x + dx] ?? ' ';
      if (c === 'L') ch = '~'; else if (c === 'E' || c === 'C') ch = c; else if (c !== ' ' && ch === ' ') ch = /[acspw]/.test(c) ? '.' : '#';
    }
    line += ch;
  }
  console.log(String(y).padStart(2) + '|' + line);
}
