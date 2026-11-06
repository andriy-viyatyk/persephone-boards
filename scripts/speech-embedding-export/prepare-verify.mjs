// Produce ignored binary inputs for verify.py from one enrollment WAV.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {logMel} from './frontend.mjs';
const dir='C:/projects/test-boards/wake-enroll-test/enroll';
const file=process.argv[2] || dir+'/'+readdirSync(dir).find(x=>x.endsWith('.wav'));
const wav=readFileSync(file); let data,format;
for(let i=12;i+8<=wav.length;){const id=wav.toString('ascii',i,i+4),size=wav.readUInt32LE(i+4),p=i+8;if(id==='fmt ')format=[wav.readUInt16LE(p),wav.readUInt16LE(p+2),wav.readUInt32LE(p+4),wav.readUInt16LE(p+14)];if(id==='data')data=wav.subarray(p,p+size);i=p+size+(size&1);}
if(String(format)!=='1,1,16000,16'||!data||data.length<41600)throw Error('Expected 16 kHz mono 16-bit PCM, at least 1.3 seconds');
const audio=Float32Array.from({length:12800},(_,i)=>data.readInt16LE((i+8000)*2)/32767),features=logMel(audio);
writeFileSync('_test/wake-export/audio.bin',Buffer.from(audio.buffer));writeFileSync('_test/wake-export/frontend.bin',Buffer.from(features.buffer));
