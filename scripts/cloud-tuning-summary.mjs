// Summarizes the runs of baseline.protostar.default-cloud-tuning (lab results JSON) per variant: first-collapse burn, when burning resumes,
// temperature of the burning gas, core plateau, helium flash (carbon above its 6 s value + 0.75 % of the mass), what is left. Dev-only.
// node scripts/cloud-tuning-summary.mjs results.json [more.json...]
import { readFileSync } from 'node:fs';

const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const f = (v, d = 1) => Number.isFinite(v) ? v.toFixed(d) : '—';

const byVariant = new Map();
for (const file of process.argv.slice(2)) {
    const r = JSON.parse(readFileSync(file, 'utf8'));
    for (const run of r.scenarios[0].metrics.runs) {
        if (!byVariant.has(run.variant)) byVariant.set(run.variant, []);
        byVariant.get(run.variant).push(run);
    }
}

for (const [variant, runs] of byVariant) {
    const rows = runs.map(run => {
        const s = run.series;
        const n = s.seconds.length;
        const h0 = s.hydrogen[0] + s.helium[0] + s.carbon[0];
        const iCollapse = s.seconds.findIndex(t => t >= 4.5);
        const burn = 1 - s.hydrogen[iCollapse] / s.hydrogen[0];
        let peakBurst = 0;
        for (let i = 0; i <= iCollapse; i++) peakBurst = Math.max(peakBurst, s.fusionRatePerSecond[i]);
        const i6 = s.seconds.findIndex(t => t >= 6);
        const c6 = s.carbon[i6];
        const iFlash = s.carbon.findIndex((c, i) => i > i6 && c > c6 + 0.0075 * h0);
        const flash = iFlash >= 0 ? s.seconds[iFlash] : null;
        const end = iFlash >= 0 ? iFlash : n;
        const plateauT = [], plateauRho = [], plateauRate = [], plateauBurnT = [];
        for (let i = i6; i < end; i++) if (s.fusionRatePerSecond[i] >= 100) { plateauT.push(s.coreTemperatureMK[i]); plateauRho.push(s.maxDensity[i]); plateauRate.push(s.fusionRatePerSecond[i]); if (s.burnTemperatureMK) plateauBurnT.push(s.burnTemperatureMK[i]); }
        const plateauBurn = (s.hydrogen[i6] - s.hydrogen[Math.min(end, n - 1)]) / h0;
        const iBack = s.seconds.findIndex((t, i) => t > 4.5 && s.fusionRatePerSecond[i] >= 100);
        const back = iBack >= 0 ? s.seconds[iBack] : null;
        const late = s.coreTemperatureMK.slice(Math.floor(n * 0.85));
        return {
            seed: run.seed, burn, peakBurst, plateau: median(plateauT), plateauRho: median(plateauRho), plateauRate: median(plateauRate), burnT: median(plateauBurnT), plateauBurn, flash, back,
            hLeft: s.hydrogen[n - 1] / h0, cEnd: s.carbon[n - 1] / h0, lateT: median(late),
            peakT6: Math.max(...s.coreTemperatureMK.slice(i6)),
        };
    });
    console.log(`\n== ${variant} (${rows.length} seeds)`);
    console.log('seed      burn%  back_s  burst/s    burnT_MK  plateauMK  rho_pl  rate_pl  Hburnt_pl%  flash_s  H_left%  C_end%  lateT  peakT>6s');
    for (const r of rows) {
        console.log(`${r.seed}  ${f(r.burn * 100).padStart(5)}  ${f(r.back).padStart(6)}  ${f(r.peakBurst, 0).padStart(8)}  ${f(r.burnT).padStart(8)}  ${f(r.plateau).padStart(9)}  ${f(r.plateauRho).padStart(6)}  ${f(r.plateauRate, 0).padStart(7)}  ${f(r.plateauBurn * 100).padStart(10)}  ${(r.flash === null ? 'none' : f(r.flash)).padStart(7)}  ${f(r.hLeft * 100).padStart(7)}  ${f(r.cEnd * 100).padStart(6)}  ${f(r.lateT, 0).padStart(5)}  ${f(r.peakT6, 0).padStart(6)}`);
    }
    const inTarget = rows.filter(r => r.plateau >= 10 && r.plateau <= 20).length;
    const flashes = rows.filter(r => r.flash !== null);
    console.log(`median: burn ${f(median(rows.map(r => r.burn)) * 100)} %, burning again at ${f(median(rows.map(r => r.back ?? Infinity)))} s, burst ${f(median(rows.map(r => r.peakBurst)), 0)}/s, BURN T ${f(median(rows.map(r => r.burnT)))} MK (${rows.filter(r => r.burnT >= 10 && r.burnT <= 20).length} in 10-20), core plateau ${f(median(rows.map(r => r.plateau)))} MK (${f(Math.min(...rows.map(r => r.plateau)))} to ${f(Math.max(...rows.map(r => r.plateau)))}; ${inTarget} of ${rows.length} in 10-20), rho ${f(median(rows.map(r => r.plateauRho)))}, rate ${f(median(rows.map(r => r.plateauRate)), 0)}/s burning ${f(median(rows.map(r => r.plateauBurn)) * 100)} % of H, flash ${flashes.length} of ${rows.length} (${f(median(flashes.map(r => r.flash)))} s), H left ${f(median(rows.map(r => r.hLeft)) * 100)} %, C end ${f(median(rows.map(r => r.cEnd)) * 100)} %, late T ${f(median(rows.map(r => r.lateT)), 0)} MK`);
}
