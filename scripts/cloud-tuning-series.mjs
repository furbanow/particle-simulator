// Prints the series of one run of baseline.protostar.default-cloud-tuning: node scripts/cloud-tuning-series.mjs results.json "<variant>" [seed] [every]. Dev-only.
import { readFileSync } from 'node:fs';
const [file, variant, seed, every = '4'] = process.argv.slice(2);
const r = JSON.parse(readFileSync(file, 'utf8'));
const run = r.scenarios[0].metrics.runs.find(x => x.variant === variant && (!seed || String(x.seed) === seed));
const s = run.series;
console.log('t      T_MK    rho    rate/s     H%    He%    C%');
for (let i = 0; i < s.seconds.length; i += Number(every)) {
  const tot = s.hydrogen[i] + s.helium[i] + s.carbon[i];
  console.log(`${s.seconds[i].toFixed(1).padStart(5)} ${s.coreTemperatureMK[i].toFixed(1).padStart(6)} ${s.maxDensity[i].toFixed(0).padStart(6)} ${s.fusionRatePerSecond[i].toExponential(1).padStart(9)} ${(100*s.hydrogen[i]/tot).toFixed(1).padStart(6)} ${(100*s.helium[i]/tot).toFixed(1).padStart(6)} ${(100*s.carbon[i]/tot).toFixed(1).padStart(6)}`);
}
