// Measures recordings from probe-audio-record.mjs against the mix targets (ffmpeg
// required). A measurement, not a listening test: it checks level, headroom, how far
// the radio rises above a fight, whether extraction builds, and whether the three
// sites differ above the rumble.
//   node probe-audio-analyze.mjs <dir>
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'

const dir = process.argv[2] ?? 'audio-out'
const sites = ['dustline-depot', 'blacksite', 'cinder-yard'].filter((s) => existsSync(`${dir}/${s}.webm`))
const stderr = (args) => spawnSync('ffmpeg', ['-nostats', ...args], { encoding: 'utf8' }).stderr

function loud(wav, ss, t) {
  const e = stderr(['-ss', String(ss), '-t', String(t), '-i', wav, '-af', 'ebur128=peak=true', '-f', 'null', '-'])
  const I = +(e.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop()?.match(/-?[\d.]+/)?.[0] ?? NaN)
  const P = +(e.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.pop()?.match(/-?[\d.]+/)?.[0] ?? NaN)
  return { I, P }
}
function band(wav, ss, t, filt) {
  const e = stderr(['-ss', String(ss), '-t', String(t), '-i', wav, '-af', `${filt},astats=metadata=0:measure_overall=RMS_level`, '-f', 'null', '-'])
  const m = [...e.matchAll(/RMS level dB:\s+(-?[\d.inf]+)/g)].pop()
  return m ? +m[1] : NaN
}

const rows = [], fails = []
const check = (ok, msg) => { (ok ? rows : fails).push(`${ok ? 'PASS' : 'FAIL'} ${msg}`) }
const air = {}
for (const s of sites) {
  const wav = `${dir}/${s}.wav`
  spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${dir}/${s}.webm`, '-ar', '48000', wav])
  // the quiet: the quietest 3 s of the soundscape (the scene's own story lines can fall in it)
  const scape = [loud(wav, 1, 3), loud(wav, 4, 3), loud(wav, 7, 3)].sort((x, y) => x.I - y.I)[0], fight = loud(wav, 10.5, 3), fight2 = loud(wav, 18, 4)
  const ext1 = loud(wav, 22.5, 3), ext2 = loud(wav, 29, 3)
  const voice = band(wav, 14.3, 3, 'highpass=f=500,lowpass=f=2500'), noVoice = band(wav, 18.3, 3, 'highpass=f=500,lowpass=f=2500')
  // A site's character, not its events: the median over nine 1 s windows. One 9 s
  // window swung up to 5 dB between takes of the same site (a passing event or not).
  const steady = (filt) => { const v = Array.from({ length: 9 }, (_, i) => band(wav, 1 + i, 1, filt)).filter(Number.isFinite).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] }
  air[s] = [steady('highpass=f=800,lowpass=f=3000'), steady('highpass=f=3000')]
  console.log(`${s}: soundscape ${scape.I} LUFS · fight ${fight2.I} LUFS (peak ${Math.max(fight.P, fight2.P)} dBFS) · voice band with radio ${voice.toFixed(1)} vs without ${noVoice.toFixed(1)} dB · extraction ${ext1.I} -> ${ext2.I} LUFS · air 0.8-3k ${air[s][0].toFixed(1)} dB, >3k ${air[s][1].toFixed(1)} dB`)
  check(fight2.I >= -21 && fight2.I <= -13, `${s}: a firefight sits at ${fight2.I} LUFS (target -21 to -13)`)
  check(Math.max(fight.P, fight2.P) <= -0.5, `${s}: firefight true peak ${Math.max(fight.P, fight2.P)} dBFS (target at or under -0.5)`)
  check(fight2.I - scape.I <= 16, `${s}: fight is ${(fight2.I - scape.I).toFixed(1)} LU over the quiet (target 16 or less: loud, not deafening)`)
  check(voice - noVoice >= 3, `${s}: the radio lifts the voice band ${(voice - noVoice).toFixed(1)} dB over the same fight (target 3 dB or more)`)
  check(ext2.I - ext1.I >= 3 && ext2.I - scape.I >= 6, `${s}: extraction builds ${(ext2.I - ext1.I).toFixed(1)} LU and ends ${(ext2.I - scape.I).toFixed(1)} LU over the quiet (targets 3 and 6)`)
}
if (sites.length === 3) {
  const d = (a, b) => Math.abs(air[a][0] - air[b][0]) + Math.abs(air[a][1] - air[b][1])
  const pairs = [['dustline-depot', 'blacksite'], ['dustline-depot', 'cinder-yard'], ['blacksite', 'cinder-yard']]
  for (const [a, b] of pairs) check(d(a, b) >= 6, `${a} vs ${b}: the air above the rumble differs by ${d(a, b).toFixed(1)} dB across the two upper bands (target 6 or more)`)
}
for (const s of sites) spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${dir}/${s}.wav`, '-lavfi', 'showspectrumpic=s=1200x320:legend=1:scale=log:fscale=log', `${dir}/${s}-spec.png`])
console.log([...rows, ...fails].join('\n'))
writeFileSync(`${dir}/report.txt`, [...rows, ...fails].join('\n') + '\n')
console.log(fails.length ? `${fails.length} failed` : 'all passed')
